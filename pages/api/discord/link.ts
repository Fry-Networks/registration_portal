import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { CommonErrors, ErrorCodes, createApiError } from '../../../lib/api-errors';
import crypto from 'crypto';

// Ensure TTL index exists (called once per process)
let indexesEnsured = false;
async function ensureIndexes(db: any) {
  if (indexesEnsured) return;
  try {
    const collection = db.collection('discord_oauth_states');
    await collection.createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 600, background: true }
    );
    await collection.createIndex(
      { state: 1 },
      { unique: true, background: true }
    );
    indexesEnsured = true;
  } catch (error) {
    // Index may already exist, that's fine
    console.warn('[discord/link] Index creation warning:', error);
    indexesEnsured = true;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Method not allowed', 'Use GET')
    );
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const walletAddress = session.user.address;

  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return res.status(500).json(
      createApiError(ErrorCodes.INTERNAL_ERROR, 'Discord OAuth not configured', 'Contact support')
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    
    // Ensure indexes exist
    await ensureIndexes(db);

    // Generate random state
    const state = crypto.randomBytes(32).toString('hex');

    // Store state in MongoDB
    await db.collection('discord_oauth_states').insertOne({
      state,
      walletAddress,
      createdAt: new Date()
    });

    // Build Discord OAuth URL
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify',
      state
    });

    const url = `https://discord.com/oauth2/authorize?${params.toString()}`;

    // Prevent caching
    res.setHeader('Cache-Control', 'no-store');
    
    return res.status(200).json({ success: true, url });
  } catch (error) {
    console.error('[discord/link] Error:', error);
    return res.status(500).json(
      createApiError(ErrorCodes.INTERNAL_ERROR, 'Failed to initiate Discord link', 'Please try again')
    );
  }
}
