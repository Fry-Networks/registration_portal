import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import clientPromise from '../../lib/mongoclient';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.address) return res.status(401).json({ error: 'Unauthorized' });

  const client = await clientPromise;
  const db = client.db('main');

  const registrationUser = await db.collection('registration-users').findOne(
    { address: session.user.address },
    { projection: { display_name: 1, discord_handle: 1, avatar_url: 1, notification_prefs: 1, _id: 0 } }
  );

  const legacyUser = await db.collection('users').findOne(
    { address: session.user.address },
    { projection: { display_name: 1, discord_handle: 1, avatar_url: 1, notification_prefs: 1, _id: 0 } }
  );

  return res.status(200).json({
    display_name: registrationUser?.display_name ?? legacyUser?.display_name ?? '',
    discord_handle: registrationUser?.discord_handle ?? legacyUser?.discord_handle ?? '',
    avatar_url: registrationUser?.avatar_url ?? legacyUser?.avatar_url ?? '',
    notification_prefs: registrationUser?.notification_prefs ?? legacyUser?.notification_prefs ?? { rewards: true, events: true, system: true },
  });
}
