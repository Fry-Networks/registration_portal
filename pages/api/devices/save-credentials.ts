import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { collectionFor, portalKeyFromMiner, getMinerType } from '../../../lib/credentials-utils';
import { ensureHardwareCredentialIndexes } from '../../../lib/hardwareCredentialIndexes';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

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

  try {
    const client = await clientPromise;
    const db = client.db(CREDS_DB_NAME);
    const collection = db.collection(collectionName);

    if (collectionName === 'hardware') {
      await ensureHardwareCredentialIndexes(db, collectionName);
    }

    // Query existing docs for this miner_key
    const existingDocs = await collection.find({ miner_key }).toArray();
    const matchingDoc = existingDocs.find((doc) => doc.address === walletAddress);
    const conflictingDoc = existingDocs.find(
      (doc) => doc.address && doc.address !== walletAddress
    );
    // NEW: Find unclaimed doc (has miner_key but no address - presale device)
    const unclaimedDoc = existingDocs.find((doc) => !doc.address);

    if (!matchingDoc && conflictingDoc) {
      return res.status(409).json(
        createApiError(
          ErrorCodes.DEVICE_OWNER_MISMATCH,
          'Credentials are already linked to another wallet',
          'Please unlink the credentials from the other wallet first.',
          { conflictAddress: conflictingDoc.address }
        )
      );
    }

    // Determine filter - handle unclaimed docs to avoid duplicate key errors
    let filter;
    if (matchingDoc) {
      // User already has a doc - update by _id
      filter = { _id: matchingDoc._id };
    } else if (unclaimedDoc) {
      // Unclaimed doc exists (presale) - claim it by _id
      filter = { _id: unclaimedDoc._id };
      loggers.dbOperation('claim_presale_credential', collection.collectionName, {
        miner_key,
        claimedBy: walletAddress,
      });
    } else {
      // No docs exist - insert new (use just miner_key for hardware to match existing index behavior)
      filter = collectionName === 'hardware' ? { miner_key } : { miner_key, address: walletAddress };
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
