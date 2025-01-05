import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const {address} = req.body;

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  const { miner_key } = req.query;

  if (!miner_key || typeof miner_key !== 'string') {
    return res.status(400).json({ error: 'Invalid or missing miner_key' });
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const device = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .findOne({ miner_key });

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    if (address) {
      if (session.user.address !== address) {
        res.status(401).json({ message: 'Unauthorized 1' });
        return;
      }

      if (device.address && device.address !== session.user.address) {
        res.status(401).json({ message: 'Unauthorized 2' });
        return;
      }
      return res.status(200).json({ device: device });
    }

    return res.status(200).json({ device: {is_registered: device.is_registered} });
  } catch (error) {
    console.error('Error fetching device', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
