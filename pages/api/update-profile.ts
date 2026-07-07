import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import clientPromise from '../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.address) return res.status(401).json({ error: 'Unauthorized' });
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { display_name, discord_handle, avatar_url, notification_prefs } = req.body;

  // Validation
  const sanitized: any = {};
  if (typeof display_name === 'string') {
    const clean = display_name.replace(/<[^>]*>/g, '').slice(0, 50);
    sanitized.display_name = clean;
  }
  if (typeof discord_handle === 'string') {
    const clean = discord_handle.replace(/<[^>]*>/g, '').slice(0, 50);
    sanitized.discord_handle = clean;
  }
  if (typeof avatar_url === 'string') {
    const url = avatar_url.trim().slice(0, 500);
    if (url === '' || url.startsWith('https://')) sanitized.avatar_url = url;
    // else reject invalid URL — skip setting it
  }
  if (notification_prefs && typeof notification_prefs === 'object') {
    // Keep only boolean fields
    const cleanPrefs: any = {};
    for (const [k, v] of Object.entries(notification_prefs)) {
      if (typeof v === 'boolean') cleanPrefs[k] = v;
    }
    sanitized.notification_prefs = cleanPrefs;
  }

  const client = await clientPromise;
  await client.db('main').collection('registration-users').updateOne(
    { address: session.user.address },
    { $set: sanitized },
    { upsert: true }
  );

  return res.status(200).json({ success: true, profile: sanitized });
}
