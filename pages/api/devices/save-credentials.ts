import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { collectionFor, portalKeyFromMiner, getMinerType } from '../../../lib/credentials-utils';
import { ensureHardwareCredentialIndexes } from '../../../lib/hardwareCredentialIndexes';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';
import { validateMacAddress, describeMacIssue } from '../../../lib/validators/macAddressValidator';

const CREDS_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  // Use server-side session retrieval in API routes
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }
  const walletAddress = session.user.address;

  const { miner_key, credentials, api_type, portal } = req.body ?? {};
  if (!miner_key || !credentials) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing required fields',
        'Please include the miner key and credentials.'
      )
    );
  }

  // Use standardized collection determination from utils.ts
  const collectionName = collectionFor({ miner_key, portalType: portal });
  // Explicit hardware-flow MAC validation
  const hardwareApiTypes = ['hardware', 'node', 'aem', 'fem'];
  if (hardwareApiTypes.includes(String(api_type).toLowerCase())) {
    const macResult = validateMacAddress(credentials.mac_address);
    if (!macResult.valid) {
      return res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Invalid or missing MAC address',
          describeMacIssue(macResult.reason)
        )
      );
    }
    credentials.mac_address = macResult.normalized;
  }


  try {
    const client = await clientPromise;
    const db = client.db(CREDS_DB_NAME);
    const collection = db.collection(collectionName);

    if (collectionName === 'hardware') {
      await ensureHardwareCredentialIndexes(db, collectionName);

      // RC1-FIX (r12, 2026-09-22): creds.hardware.address is the ownership proof
      // lib/rebindOwnership.ts uses to let a wallet recover a device-wallet-clobbered
      // registration. Until now ANY session could mint that proof for ANY miner key -- with
      // no record present the upsert below wrote { miner_key, address: <session wallet> } --
      // so knowing a key (they circulate in support threads) was enough to take the device.
      // A hardware credential save may therefore only touch a key whose main.devices doc is
      // unbound or already bound to this wallet. The first-time registration flow is
      // unaffected: pages/register.tsx saves credentials while the device is still unbound.
      const ownerTestMode =
        process.env.NEXT_PUBLIC_TEST_MODE &&
        process.env.NEXT_PUBLIC_TEST_MODE === 'true';
      const devicesCollection = client
        .db('main')
        .collection(ownerTestMode ? 'test-devices' : 'devices');
      let deviceDoc = await devicesCollection.findOne(
        { miner_key },
        { projection: { address: 1, _id: 0 } }
      );
      if (!deviceDoc && /^FEM-[A-Za-z0-9]{32}$/.test(String(miner_key))) {
        // Same case-insensitive FEM lookup both registration routes do, so a differently
        // cased key cannot be used to slip past this check.
        deviceDoc = await devicesCollection.findOne(
          { miner_key: { $regex: `^${miner_key}$`, $options: 'i' } },
          { projection: { address: 1, _id: 0 } }
        );
      }
      const deviceOwner =
        typeof deviceDoc?.address === 'string' ? deviceDoc.address.trim() : '';
      if (deviceOwner && deviceOwner !== walletAddress) {
        return res.status(409).json(
          createApiError(
            ErrorCodes.DEVICE_OWNER_MISMATCH,
            'This device is linked to a different wallet',
            'Please sign in with the wallet that owns this device, or contact support.'
          )
        );
      }
    }

    let filter: Record<string, unknown> = { miner_key, address: walletAddress };

    if (collectionName === 'hardware') {
      const existingDocs = await collection.find({ miner_key }).toArray();
      const matchingDoc = existingDocs.find((doc) => doc.address === walletAddress);
      const conflictingDoc = existingDocs.find(
        (doc) => doc.address && doc.address !== walletAddress
      );

      if (!matchingDoc && conflictingDoc) {
        return res.status(409).json(
          createApiError(
            ErrorCodes.DEVICE_OWNER_MISMATCH,
            'Hardware credentials are already linked to another wallet',
            'Please unlink the credentials from the other wallet first.',
            { conflictAddress: conflictingDoc.address }
          )
        );
      }

      filter = matchingDoc ? { _id: matchingDoc._id } : { miner_key };
    }

    // Use portal key for named collections, miner type for hardware devices
    const portalKey = portalKeyFromMiner(miner_key);
    const miner_type = (collectionName === 'hardware') ? getMinerType(miner_key) : portalKey;
    const updateSet: any = {
      miner_key,
      miner_type,
      address: walletAddress,
      credentials,
      credentials_saved_at: new Date(),
    };

    // Only include api_type for non-MAC-only types. For hardware/node/aem we intentionally omit api_type
    // since the only credential is mac_address and we only want miner_type stored.
    if (api_type && !['hardware', 'node', 'aem', 'fem'].includes(String(api_type).toLowerCase())) {
      updateSet.api_type = String(api_type).toLowerCase();
    }

    if (credentials.mac_address) { updateSet.miner_mac = credentials.mac_address; }
    const update = { $set: updateSet };

    // Capture old MAC for audit logging before the update
    let oldMac: string | null = null;
    try {
      const existingDoc = await collection.findOne(filter, { projection: { miner_mac: 1 } });
      if (existingDoc?.miner_mac) {
        oldMac = String(existingDoc.miner_mac);
      }
    } catch (auditReadErr) {
      // Non-blocking: audit read failure should not stop the save
      console.error('[save-credentials] Failed to read old MAC for audit:', auditReadErr);
    }

    await collection.updateOne(filter, update, { upsert: true });

    // Audit log MAC changes
    if (credentials.mac_address && oldMac !== credentials.mac_address) {
      try {
        const auditEntry = {
          miner_key,
          address: walletAddress,
          old_mac: oldMac,
          new_mac: credentials.mac_address,
          changed_at: new Date(),
          source: 'user_dashboard',
          collection: collectionName,
        };
        try {
          const mainDb = client.db('main');
          const auditColl = mainDb.collection('mac_audit_logs');
          await auditColl.insertOne(auditEntry);
        } catch (mainErr) {
          // Fallback: write to creds DB if main DB is unreachable or unwritable
          console.error('[save-credentials] main.mac_audit_logs insert failed, falling back to creds:', mainErr);
          const fallbackDb = client.db(CREDS_DB_NAME);
          const fallbackColl = fallbackDb.collection('mac_audit_logs');
          await fallbackColl.insertOne(auditEntry);
        }
      } catch (auditWriteErr) {
        // Never fail the request because of audit logging
        console.error('[save-credentials] Audit log write failed:', auditWriteErr);
      }
    }

    return res.status(200).json({ message: 'Credentials persisted to creds DB', collection: collectionName });
  } catch (error: any) {
    handleApiError(res, '/api/devices/save-credentials', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to save device credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey: miner_key,
      walletAddress,
      issueType: 'DEVICE_CREDENTIAL_SAVE_ERROR',
      part: 'devices.save-credentials.handler',
      metadata: {
        miner_key,
        address: walletAddress,
        collection: collectionName,
        api_type,
        portal,
      },
    });
  }
}

