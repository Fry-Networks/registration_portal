import clientPromise from '../../lib/mongoclient';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  const { address } = req.body;

  if (!address) return res.status(400).json({ success: false, message: 'Address is required' });

  const client = await clientPromise;
  const db = client.db('main');
  const usersCollection = db.collection('registration-users');

  const user = await usersCollection.findOne({ address });
  const isNew =
    !user || !user.email || !user.first_name || !user.last_name;
  res.status(200).json({ isNew });  
}
