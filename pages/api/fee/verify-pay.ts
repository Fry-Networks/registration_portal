import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import algosdk, { waitForConfirmation } from 'algosdk';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { verifyTransaction } from '../algorand/verify-txn';

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
  // Check if user is authenticated
  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }
  const client = await clientPromise;
  const db = client.db('main');

  const data: {
    miner_key: string;
    txId: string;
    address: string;
  } = req.body;
  const { miner_key, txId, address } = data;

  try {
    const checking = await verifyTransaction(txId, address);

    if (checking) {
      const collection = db.collection(testMode ? 'test-devices' : 'devices');
      await collection.updateOne(
        { miner_key: miner_key, address: session.user.address },
        {
          $set: {
            'staked.withdraw_boost': true
          }
        }
      );
      return res.status(200).json({ message: 'ok' });
    } else {
      return res.status(500).json({ message: 'ok' });
    }
  } catch (error) {}
}
