import type { MongoClient } from 'mongodb';

// Online device computation (DASH-B4 fix): Primary signal = PoC.hardware.lastUpdated (real-time 60s heartbeat)
// Secondary = PoC.installations leases (legacy); Tertiary = poc_reward_dailies (14-day window)
// NOTE: lastUpdated is ISO STRING with tz-suffix ("2026-07-17T20:08:36+00:00"), requires $dateFromString parsing
export const TRACKED_PREFIXES = ['AEM', 'BM', 'FEM', 'RDN', 'SDN', 'SVN', 'CN'];

export async function computeActiveSet(
  client: MongoClient,
  minerKeys: string[],
  lookbackDays = 14
): Promise<Set<string>> {
  const active = new Set<string>();
  const tracked = minerKeys.filter(
    (k) => typeof k === 'string' && TRACKED_PREFIXES.includes(k.split('-')[0])
  );
  if (tracked.length === 0) return active;

  let hardwareMatched = new Set<string>();

  // TIER 1: PRIMARY — PoC.hardware.lastUpdated (15-min window for real-time heartbeats)
  try {
    const hardware = client.db('PoC').collection('hardware');
    const hardwareCutoff = new Date(Date.now() - 15 * 60 * 1000);
    
    const recentHeartbeats: Array<{miner_key: string}> = await hardware
      .aggregate<{ miner_key: string }>([
        {
          $match: {
            miner_key: { $in: tracked },
            lastUpdated: { $exists: true }
          }
        },
        {
          $addFields: {
            // Parse ISO string ("2026-07-17T20:08:36+00:00") to Date for comparison
            lastUpdatedDate: {
              $dateFromString: {
                dateString: "$lastUpdated",
                onError: null
              }
            }
          }
        },
        {
          $match: {
            lastUpdatedDate: { $gte: hardwareCutoff }
          }
        },
        {
          $project: { miner_key: 1 }
        }
      ])
      .toArray();
    
    for (const doc of recentHeartbeats) {
      active.add(doc.miner_key);
      hardwareMatched.add(doc.miner_key);
    }
    
    if (hardwareMatched.size > 0) {
      console.log(`[deviceActivity] Hardware: matched ${hardwareMatched.size}/${tracked.length} via PoC.hardware.lastUpdated (15-min window)`);
    }
  } catch (err) {
    console.error('[deviceActivity] Hardware lookup failed', err);
    // IMPORTANT: Do NOT skip tiers 2 & 3 — continue regardless of hardware success/failure
  }

  // TIER 2: SECONDARY — PoC.installations leases (ALWAYS runs, independent of Tier 1)
  const leaseKeys = tracked.filter((k) => !hardwareMatched.has(k));
  if (leaseKeys.length > 0) {
    try {
      const installations = client.db('PoC').collection('installations');
      const known: string[] = await installations.distinct('miner_key', {
        miner_key: { $in: leaseKeys }
      });
      
      if (known.length > 0) {
        const live: string[] = await installations.distinct('miner_key', {
          miner_key: { $in: known },
          lease_expires_at: { $gt: new Date() }
        });
        for (const k of live) active.add(k);
        
        if (live.length > 0) {
          console.log(`[deviceActivity] Leases: matched ${live.length} via valid lease_expires_at (legacy fallback)`);
        }
      }
    } catch (err) {
      console.error('[deviceActivity] Lease lookup failed', err);
    }
  }

  // TIER 3: TERTIARY — poc_reward_dailies (14-day window, ALWAYS runs, independent)
  const dailyKeys = tracked.filter((k) => !active.has(k));
  if (dailyKeys.length > 0) {
    try {
      const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
      const dailies: string[] = await client
        .db('main')
        .collection('poc_reward_dailies')
        .distinct('miner_key', { miner_key: { $in: dailyKeys }, date: { $gte: cutoff } });
      
      for (const k of dailies) active.add(k);
      
      if (dailies.length > 0) {
        console.log(`[deviceActivity] Dailies: matched ${dailies.length} via 14-day poc_reward_dailies (fallback)`);
      }
    } catch (err) {
      console.error('[deviceActivity] Daily lookup failed', err);
    }
  }

  return active;
}
