import type { MongoClient } from 'mongodb';

// Truthful device-activity computation (B2).
// Primary signal: an unexpired mining lease in PoC.installations — live devices
// renew their lease every few minutes, so lease_expires_at > now is minute-level
// truth for lease-holding devices (FEM/BM). A device with installation history
// but no live lease is OFFLINE, no matter how recently it earned daily rewards.
// Devices that never lease (AEM, node prefixes) fall back to the 14-day
// poc_reward_dailies signal — the only activity evidence they produce.
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

  let leaseKnown = new Set<string>();
  try {
    const installations = client.db('PoC').collection('installations');
    const known: string[] = await installations.distinct('miner_key', {
      miner_key: { $in: tracked }
    });
    leaseKnown = new Set(known);
    if (known.length > 0) {
      const live: string[] = await installations.distinct('miner_key', {
        miner_key: { $in: known },
        lease_expires_at: { $gt: new Date() }
      });
      for (const k of live) active.add(k);
    }
  } catch (err) {
    // PoC read unavailable — degrade to the daily fallback for every device.
    console.error('[deviceActivity] PoC lease lookup failed, using daily fallback', err);
    leaseKnown = new Set();
  }

  const fallbackKeys = tracked.filter((k) => !leaseKnown.has(k));
  if (fallbackKeys.length > 0) {
    const cutoff = new Date(Date.now() - lookbackDays * 86400000).toISOString().slice(0, 10);
    const dailies: string[] = await client
      .db('main')
      .collection('poc_reward_dailies')
      .distinct('miner_key', { miner_key: { $in: fallbackKeys }, date: { $gte: cutoff } });
    for (const k of dailies) active.add(k);
  }
  return active;
}
