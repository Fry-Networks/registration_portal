import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { ObjectId } from 'mongodb';
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

  const { id } = req.query;
  if (typeof id !== 'string' || !ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'Invalid event id' });
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const event = await db.collection('events').findOne({ _id: new ObjectId(id) });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const walletAddress = session.user.address;
    const leaderboard = (event.leaderboard ?? [])
      .slice()
      .sort((a: any, b: any) => b.score - a.score);
    const myIndex = leaderboard.findIndex(
      (e: any) => e.wallet === walletAddress
    );
    const myRank = myIndex >= 0 ? myIndex + 1 : null;
    const myScore = myIndex >= 0 ? leaderboard[myIndex].score : null;

    let myTier = null;
    if (myRank && event.prizeTiers?.length) {
      const sorted = [...event.prizeTiers].sort(
        (a: any, b: any) => a.maxRank - b.maxRank
      );
      for (const tier of sorted) {
        if (myRank <= tier.maxRank) {
          myTier = tier;
          break;
        }
      }
    }

    res.status(200).json({
      event: {
        _id: event._id,
        name: event.name,
        description: event.description,
        status: event.status,
        startDate: event.startDate,
        endDate: event.endDate,
        prize: event.prize,
        prizeTiers: event.prizeTiers,
        winners: event.winners,
        metric: {
          type: event.metric?.type,
          lastRefreshAt: event.metric?.lastRefreshAt,
        },
        bannerImage: event.bannerImage,
        ctaLink: event.ctaLink,
        audience: event.audience,
      },
      leaderboard,
      myRank,
      myScore,
      myTier,
    });
  } catch (error) {
    console.error('Event detail error:', error);
    res.status(500).json({ message: 'Failed to load event' });
  }
}
