import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import algosdk from 'algosdk';
import clientPromise from '../../../lib/mongoclient';
import { getFRYPrice } from '../../../lib/price';
import { Device, Product } from '../../../lib/types';
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const devMode =
    process.env.NEXT_PUBLIC_DEV_MODE &&
    process.env.NEXT_PUBLIC_DEV_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    miner_key: string;
  } = req.body;

  const { address, miner_key } = data;
  if (session.user.address !== address || !address) {
    // console.log(
    //   `get miner type session.user.address: ${session.user.address}, address: ${address} SPOOF`
    // );
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection(testMode ? 'test-devices' : 'devices');
    const device = (await collection.findOne({
      miner_key
    })) as unknown as Device;

    const deviceType = device.miner_key.split('-')[0];
    const product = (await db
      .collection('products')
      .findOne({ key: deviceType })) as Product;
    if (!device) {
      res.status(404).json({ message: 'not found' });
      return;
    }
    if (!device.staked) {
      res.status(401).json({ message: 'Unauthorized 3' });
      return;
    }
    if (device.staked?.amount == 0) {
      res.status(401).json({ message: 'Unauthorized 4' });
      return;
    }

    if (!device.address || device.address !== session.user.address) {
      res.status(401).json({ message: 'Unauthorized 5' });
      return;
    }

    const dayCheck =
      (Date.now() - new Date(device.staked.time).getTime()) /
        (1000 * 60 * 60 * 24) >
      1;
    const sixMonthsCheck =
      (Date.now() - new Date(device.staked.time).getTime()) /
        (1000 * 60 * 60 * 24) >
      180;

    const data = {
      available:
        devMode || device.staked.asset_id !== product.reward.tokens?.stake
          ? true
          : device.staked.type == 'one'
            ? dayCheck
            : sixMonthsCheck,
      availableIn:
        device.staked.type == 'one'
          ? new Date(device.staked.time).getTime() + 1000 * 60 * 60 * 24
          : new Date(device.staked.time).getTime() + 1000 * 60 * 60 * 24 * 180
    };

    res.status(200).json({ message: 'ok', data });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}
