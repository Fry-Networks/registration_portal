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
  const hardwareApiTypes = ['hardware', 'node', 'aem'];
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
    if (api_type && !['hardware', 'node', 'aem'].includes(String(api_type).toLowerCase())) {
      updateSet.api_type = String(api_type).toLowerCase();
    }

    if (credentials.mac_address) { updateSet.miner_mac = credentials.mac_address; }
    const update = { $set: updateSet };

    await collection.updateOne(filter, update, { upsert: true });

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
