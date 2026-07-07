import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const modeDoc = await db.collection('configs').findOne({ _id: 'reward_mode' } as any);
    const mode = modeDoc?.mode || 'FRY2';
    const fry3AsaId = modeDoc?.fry3_asa_id || '3612979527';
    const activeFryAsaId = mode === 'FRY3' ? fry3AsaId : '2485314946';
    const activeFryName = mode === 'FRY3' ? 'FRY' : 'FRY 2.0';
    return res.status(200).json({ mode, active_fry_asa_id: activeFryAsaId, active_fry_name: activeFryName });
  } catch {
    return res.status(200).json({ mode: 'FRY2', active_fry_asa_id: '2485314946', active_fry_name: 'FRY 2.0' });
  }
}
