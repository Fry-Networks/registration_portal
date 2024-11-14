import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import algosdk from 'algosdk';
import clientPromise from '../../lib/mongoclient';
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const testMode = process.env.TEST_MODE && process.env.TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    console.log(`no session`);
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    byod: string;
    key: string;
  } = req.body;

  const { address, byod, key } = data;
  if (session.user.address !== address || !address) {
    console.log(
      `byod session.user.address: ${session.user.address}, address: ${address} SPOOF`
    );
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }
  if (['SDN', 'RDN', 'SVN'].includes(key)) {
    res.status(400).json({ message: 'Invalid key' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('byods');
    const license = (
      await collection
        .find({
          'licenses.license': byod
        })
        .toArray()
    )[0];
    console.log(license);
    if (!license) {
      res.status(404).json({ message: 'Not found' });
      return;
    }
    const productsCollection = db.collection('products');
    const products = await productsCollection.find({}).toArray();
    const data = products.map((product) => {
      return { name: product.name, key: product.key };
    });
    if (!data.find((product) => product.key === key)) {
      res.status(404).json({ message: 'Not found' });
      return;
    }
    const product = data.find((product) => product.key === key)!;
    const devicesCollection = db.collection(
      testMode ? 'test-devices' : 'devices'
    );
    const byodAlreadyUsed = await devicesCollection.findOne({ byod: byod });
    if (byodAlreadyUsed) {
      res.status(400).json({ message: 'Byod already used' });
      return;
    }
    let minerkey = generateMinerKey(key);
    while (await devicesCollection.findOne({ miner_key: minerkey })) {
      minerkey = generateMinerKey(key);
    }
    await devicesCollection.insertOne({
      miner_key: minerkey,
      address: session.user.address,
      created_at: new Date(),
      email: license.email,
      name: product.name,
      byod: byod,
      is_registered: false
    });

    res.status(200).json({ message: 'ok', miner_key: minerkey });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}

const generateMinerKey = (key: string) => {
  const str = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let minerKey = key + '-';
  for (let i = 0; i < 32; i++) {
    minerKey += str.charAt(Math.floor(Math.random() * str.length));
  }
  return minerKey;
};
