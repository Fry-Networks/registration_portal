import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { getTransactionTime } from '../../../lib/utils';
import algosdk, { mnemonicToSecretKey } from 'algosdk';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/txn';

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
    const result = await verifyTransaction(account.addr, txId);
    if (result !== VERIFY_RESULT.OK) {
      // not confirmed yet
      res.status(200).json({ success: false, code: 'NETWORK_ERROR', message: 'Not yet confirmed' });
      return;
    }

    // Get exact on-chain timestamp
    const claimedAt = await getTransactionTime(txId);

    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-rewards' : 'rewards');
    await collection.updateMany(
      { txId },
      { $set: { claimedAt } }
    );

    res.status(200).json({ success: true, claimedAt });
  } catch (e) {
    console.error('confirm error:', e);
    res.status(500).json({ success: false, code: 'NETWORK_ERROR', message: 'Internal server error' });
  }
}
