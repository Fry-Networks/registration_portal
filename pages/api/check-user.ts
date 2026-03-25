import { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { address } = req.body;

  if (!address) {
    return res.status(400).json({ error: 'Address is required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const usersCollection = db.collection('registration-users');

    const user = await usersCollection.findOne({ address });
    const isNew =
      !user || !user.email || !user.first_name || !user.last_name;
    res.status(200).json({ isNew });
  } catch (error) {
    console.error('[check-user] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
