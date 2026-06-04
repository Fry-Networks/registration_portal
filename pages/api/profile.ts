import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import clientPromise from '../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.address) return res.status(401).json({ error: 'Unauthorized' });

  const client = await clientPromise;
  const user = await client.db('main').collection('users').findOne(
    { address: session.user.address },
    { projection: { display_name: 1, discord_handle: 1, avatar_url: 1, notification_prefs: 1 } }
  );

  return res.status(200).json({
    display_name: user?.display_name ?? '',
    discord_handle: user?.discord_handle ?? '',
    avatar_url: user?.avatar_url ?? '',
    notification_prefs: user?.notification_prefs ?? { rewards: true, events: true, system: true },
  });
}
