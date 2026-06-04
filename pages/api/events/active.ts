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
    const eventsCol = db.collection('events');
    const now = new Date();

    // Active events: status=active AND within date range
    const activeEvents = await eventsCol
      .find({
        status: 'active',
        startDate: { $lte: now },
        endDate: { $gte: now },
      })
      .sort({ startDate: -1 })
      .toArray();

    // Recently ended events (last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentEvents = await eventsCol
      .find({
        status: 'ended',
        endDate: { $gte: thirtyDaysAgo },
      })
      .sort({ endDate: -1 })
      .limit(5)
      .toArray();

    const walletAddress = session.user.address;

    const enrichEvent = (event: any) => {
      const leaderboard = (event.leaderboard ?? [])
        .slice()
        .sort((a: any, b: any) => b.score - a.score);
      const myIndex = leaderboard.findIndex(
        (e: any) => e.wallet === walletAddress
      );
      const myRank = myIndex >= 0 ? myIndex + 1 : null;
      const myScore = myIndex >= 0 ? leaderboard[myIndex].score : null;

      // Determine qualifying prize tier
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

      return {
        _id: event._id,
        name: event.name,
        description: event.description,
        status: event.status,
        startDate: event.startDate,
        endDate: event.endDate,
        prize: event.prize,
        prizeTiers: event.prizeTiers,
        metric: {
          type: event.metric?.type,
          lastRefreshAt: event.metric?.lastRefreshAt,
        },
        bannerImage: event.bannerImage,
        ctaLink: event.ctaLink,
        leaderboardCount: leaderboard.length,
        topEntries: leaderboard.slice(0, 10),
        myRank,
        myScore,
        myTier,
      };
    };

    res.status(200).json({
      active: activeEvents.map(enrichEvent),
      recent: recentEvents.map(enrichEvent),
    });
  } catch (error) {
    console.error('Events active error:', error);
    res.status(500).json({ message: 'Failed to load events' });
  }
}
