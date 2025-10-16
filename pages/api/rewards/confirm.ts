import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { getTransactionTime } from '../../../lib/utils';
import algosdk, { mnemonicToSecretKey } from 'algosdk';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/txn';
import { verifyClientToken } from '../../../lib/clientTokenMiddleware';
import { verifyRequestSignature } from '../../../lib/requestSignature.server';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Layer 1: Verify client token to prevent automated scripts from calling this endpoint
  // This check happens FIRST (before session check) for early bot detection
  if (!verifyClientToken(req, res)) {
    return;
  }

  // Layer 2: Verify request signature to prevent body tampering and replay attacks
  // This check also happens early for efficient bot detection
  const signature = req.headers['x-request-signature'] as string;
  const timestamp = parseInt(req.headers['x-request-timestamp'] as string, 10);

  if (!signature || !timestamp) {
    res.status(403).json({
      success: false,
      code: 'MISSING_SIGNATURE',
      message: 'Request signature or timestamp missing'
    });
    return;
  }

  if (!verifyRequestSignature(req.method || 'POST', req.url || '/api/rewards/confirm', req.body, timestamp, signature)) {
    res.status(403).json({
      success: false,
      code: 'INVALID_SIGNATURE',
      message: 'Invalid request signature'
    });
    return;
  }

  // Session check happens AFTER security verification
  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json({ success: false, code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  const { txId } = req.body as { txId: string };
  if (!txId) {
    res.status(400).json({ success: false, code: 'NETWORK_ERROR', message: 'Missing txId' });
    return;
  }

  try {
    // Verify against the sender vault address
    const account = mnemonicToSecretKey(process.env.REWARD_MNEMONIC!);
    const result = await verifyTransaction(account.addr.toString(), txId);
    if (result !== VERIFY_RESULT.OK) {
      // not confirmed yet
      res.status(200).json({ success: false, code: 'NETWORK_ERROR', message: 'Not yet confirmed' });
      return;
    }

    // Get exact on-chain timestamp
    const claimedAt = await getTransactionTime(txId);

    const client = await clientPromise;
    const db = client.db('main');
    // Update device-rewards entries (weekly and daily) with chain timestamp
    const weeklyCollection = db.collection('device-rewards');
    await weeklyCollection.updateMany(
      { 'weekly_rewards.tx_id': txId },
      { $set: { 'weekly_rewards.$[elem].claimed_at': claimedAt } },
      { arrayFilters: [{ 'elem.tx_id': txId }] }
    );
    await weeklyCollection.updateMany(
      { 'daily_rewards.tx_id': txId },
      { $set: { 'daily_rewards.$[elem].claimed_at': claimedAt } },
      { arrayFilters: [{ 'elem.tx_id': txId }] }
    );

    res.status(200).json({ success: true, claimedAt });
  } catch (e) {
    console.error('confirm error:', e);
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
