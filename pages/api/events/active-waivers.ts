import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import clientPromise from '../../../lib/mongoclient';
import { authOptions } from '../auth/[...nextauth]';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.address) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const now = new Date();

    // Find active events with registration stake waivers
    const events = await db
      .collection('events')
      .find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now },
        'waivedRequirements.registrationStake': true,
      })
      .project({ 'waivedRequirements.minerTypes': 1 })
      .toArray();

    // Union all waived miner types across active events
    const waivedMinerTypes = new Set<string>();
    for (const event of events) {
      const types = event.waivedRequirements?.minerTypes ?? [];
      for (const t of types) {
        waivedMinerTypes.add(t);
      }
    }

    res.status(200).json({
      waivedMinerTypes: Array.from(waivedMinerTypes),
    });
  } catch (error) {
    console.error('Active waivers error:', error);
    res.status(500).json({ message: 'Failed to load waivers' });
  }
}
