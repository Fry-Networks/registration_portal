import type { MongoClient } from 'mongodb';

// Online device computation (DASH-B4 fix): Primary signal = PoC.hardware.lastUpdated (real-time 60s heartbeat)
// Secondary = PoC.installations leases (legacy); Tertiary = poc_reward_dailies (14-day window)
// NOTE: lastUpdated is ISO STRING with tz-suffix ("2026-07-17T20:08:36+00:00"), requires $dateFromString parsing
// Matched against the KEY prefix (k.split('-')[0]), so the IOTVPN miner code appears here as
// IOT. Mirrors hardwareapi's deployed MinerCode enum; a prefix missing here can never
// compute as online or reward-eligible.
export const TRACKED_PREFIXES = ['AEM', 'BM', 'CN', 'FEM', 'IDM', 'IOT', 'IRM', 'ISM', 'ODM', 'OSM', 'RDN', 'SDN', 'SVN'];

// Tier 3 answers "was this device earning recently", not "is it online now". A row is
// written for every device the reward job processes, so presence alone marked ~11.5k
// disconnected devices Active; the row must show real work (slots_valid > 0) and be
// recent. Tiers 1-2 (15-min heartbeat / live lease) remain the real-time signals.
export const ACTIVITY_LOOKBACK_DAYS = 1;

// A lookup failure that leaves us with zero devices must not be reported as
// "0 online" — that reads as "your miners are down" when the truth is "we could
// not check". `degraded` lets callers say so instead.
export type ActiveSetResult = { active: Set<string>; degraded: boolean };

export async function computeActiveSet(
  client: MongoClient,
  minerKeys: string[],
  lookbackDays = ACTIVITY_LOOKBACK_DAYS
): Promise<Set<string>> {
  return (await computeActiveSetDetailed(client, minerKeys, lookbackDays)).active;
}

export async function computeActiveSetDetailed(
  client: MongoClient,
  minerKeys: string[],
  lookbackDays = ACTIVITY_LOOKBACK_DAYS
): Promise<ActiveSetResult> {
  const active = new Set<string>();
  let lookupFailed = false;
  const tracked = minerKeys.filter(
    (k) => typeof k === 'string' && TRACKED_PREFIXES.includes(k.split('-')[0])
  );
  if (tracked.length === 0) return { active, degraded: false };

  let hardwareMatched = new Set<string>();

  // TIER 1: PRIMARY — PoC.hardware.lastUpdated (15-min window for real-time heartbeats)
  //
  // WINDOW 1 of 2, and the two are NOT interchangeable:
  //   * 15 minutes (here) answers "is this device online right now" for the DISPLAY state.
  //     It is deliberately tight so a dead miner stops showing as online within a heartbeat
  //     or two. It gates presentation only; no reward decision reads it.
  //   * 24 hours (POC_STALE_MS, below) answers "is this device still earning". That value
  //     MIRRORS hardwareapi's POC_LIVENESS_STALENESS_SECONDS and must keep mirroring it.
  // Widening this one to 24h would report dead hardware as online; narrowing POC_STALE_MS to
  // 15m would strip rewards from devices hardwareapi still considers live, and the dashboard
  // would disagree with the service that actually pays them.
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
    lookupFailed = true;
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
      lookupFailed = true;
      console.error('[deviceActivity] Lease lookup failed', err);
    }
  }

  // TIER 3: TERTIARY — poc_reward_dailies, recent AND with validated work (ALWAYS runs)
  const dailyKeys = tracked.filter((k) => !active.has(k));
  if (dailyKeys.length > 0) {
    try {
      const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
      const dailies: string[] = await client
        .db('main')
        .collection('poc_reward_dailies')
        .distinct('miner_key', { miner_key: { $in: dailyKeys }, date: { $gte: cutoff }, slots_valid: { $gt: 0 } });
      
      for (const k of dailies) active.add(k);
      
      if (dailies.length > 0) {
        console.log(`[deviceActivity] Dailies: matched ${dailies.length} via ${lookbackDays}-day poc_reward_dailies with validated slots (fallback)`);
      }
    } catch (err) {
      lookupFailed = true;
      console.error('[deviceActivity] Daily lookup failed', err);
    }
  }

  return { active, degraded: lookupFailed && active.size === 0 };
}

// Why a device that looks online still earns nothing: hardwareapi stamps
// PoC.hardware.reward_eligible on every heartbeat and dbRewards short-circuits on
// `=== false`, so the dashboard can show the same verdict instead of a silent zero.
export type RewardEligibility = {
  eligible: boolean | null;
  reason: 'ok' | 'no_poc_data' | 'update_required' | 'no_recent_heartbeat' | 'ineligible' | null;
  pocVersionInstalled?: string;
  pocVersionRequired?: string;
  lastUpdated?: string;
};

// WINDOW 2 of 2 — reward ELIGIBILITY staleness, not the online indicator.
// Mirrors hardwareapi POC_LIVENESS_STALENESS_SECONDS (86400). hardwareapi owns this number:
// it decides whether a device earns, and this constant exists so the dashboard reports the
// same verdict. If hardwareapi's value changes, change this one in the same run, or the
// dashboard will tell users they are earning when the paying service disagrees.
// Do NOT reuse the 15-minute display window above for this purpose.
const POC_STALE_MS = 24 * 60 * 60 * 1000;

// Mirror hardwareapi's semantic version gate (poc_eligibility._version_at_least):
// a client NEWER than the pin is eligible; only an OLDER one needs an update.
const parseVersionParts = (raw: unknown): number[] | null => {
  if (raw === null || raw === undefined) return null;
  const parts = String(raw).trim().split('.');
  if (parts.length === 0 || parts.length > 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d+$/.test(p)) return null;
    out.push(parseInt(p, 10));
  }
  while (out.length < 3) out.push(0);
  return out.slice(0, 4);
};

const versionAtLeast = (installed: unknown, required: unknown): boolean => {
  const iv = parseVersionParts(installed);
  const rv = parseVersionParts(required);
  if (!iv || !rv) return false;
  const len = Math.max(iv.length, rv.length);
  for (let i = 0; i < len; i++) {
    const a = i < iv.length ? iv[i] : 0;
    const b = i < rv.length ? rv[i] : 0;
    if (a !== b) return a > b;
  }
  return true;
};

export async function getRewardEligibility(
  client: MongoClient,
  minerKeys: string[]
): Promise<Map<string, RewardEligibility>> {
  const out = new Map<string, RewardEligibility>();
  const tracked = minerKeys.filter(
    (k) => typeof k === 'string' && TRACKED_PREFIXES.includes(k.split('-')[0])
  );
  if (tracked.length === 0) return out;

  try {
    const poc = client.db('PoC');
    const docs = await poc
      .collection('hardware')
      .find(
        { miner_key: { $in: tracked } },
        { projection: { miner_key: 1, reward_eligible: 1, lastUpdated: 1, software: 1 } }
      )
      .toArray();
    const codes = Array.from(new Set(tracked.map((k) => k.split('-')[0])));
    const versionDocs = await poc
      .collection('versions')
      .find({ miner_code: { $in: codes } })
      .toArray();

    const versionByCode = new Map<string, any>(
      versionDocs.map((v: any) => [String(v.miner_code), v])
    );
    const byKey = new Map<string, any>(docs.map((d: any) => [String(d.miner_key), d]));

    for (const key of tracked) {
      const doc = byKey.get(key);
      if (!doc) {
        out.set(key, { eligible: null, reason: 'no_poc_data' });
        continue;
      }
      if (doc.reward_eligible !== false) {
        out.set(key, {
          eligible: doc.reward_eligible === true ? true : null,
          reason: doc.reward_eligible === true ? 'ok' : null
        });
        continue;
      }

      const software = doc.software ?? {};
      const versionDoc = versionByCode.get(key.split('-')[0]) ?? {};
      const osKey = software.os;
      const required =
        (osKey && versionDoc[osKey] && versionDoc[osKey].poc_version_needed) ||
        versionDoc.poc_version_needed;
      const installed = software.poc_version_installed;
      const lastUpdatedMs = doc.lastUpdated ? Date.parse(String(doc.lastUpdated)) : NaN;

      let reason: RewardEligibility['reason'] = 'ineligible';
      if (required && installed && !versionAtLeast(installed, required)) {
        reason = 'update_required';
      } else if (!Number.isFinite(lastUpdatedMs) || Date.now() - lastUpdatedMs > POC_STALE_MS) {
        reason = 'no_recent_heartbeat';
      }

      out.set(key, {
        eligible: false,
        reason,
        pocVersionInstalled: installed,
        pocVersionRequired: required,
        lastUpdated: doc.lastUpdated
      });
    }
  } catch (err) {
    console.error('[deviceActivity] Reward eligibility lookup failed', err);
  }

  return out;
}
