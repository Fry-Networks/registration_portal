import type { MongoClient } from 'mongodb';

// Forward PoC evidence guard for the claim path — mirror of push_distribute_v2 `poc_in_window`:
// a device is evidenced for a window if PoC.hardware has a reward date-key inside it, OR a
// PoC.installations lease (first_installed_at..last_seen_at) overlaps it.
export type Evidence = { dates: Set<string>; leases: Array<[Date, Date]> };

export async function loadEvidence(client: MongoClient, minerKey: string): Promise<Evidence> {
  const poc = client.db('PoC');
  const dates = new Set<string>();
  const hw = await poc
    .collection('hardware')
    .findOne({ miner_key: minerKey }, { projection: { rewards: 1 } });
  if (hw?.rewards && typeof hw.rewards === 'object') {
    for (const k of Object.keys(hw.rewards)) dates.add(k);
  }
  const leases: Array<[Date, Date]> = [];
  const inst = await poc
    .collection('installations')
    .find({ miner_key: minerKey }, { projection: { first_installed_at: 1, last_seen_at: 1 } })
    .toArray();
  for (const i of inst) {
    const f = i.first_installed_at ? new Date(i.first_installed_at) : null;
    const l = i.last_seen_at ? new Date(i.last_seen_at) : null;
    if (f && l && !isNaN(f.getTime()) && !isNaN(l.getTime())) leases.push([f, l]);
  }
  return { dates, leases };
}

export function hasEvidenceInWindow(ev: Evidence, start: Date, end: Date): boolean {
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return false;
  for (const k of ev.dates) {
    const d = new Date(k);
    if (!isNaN(d.getTime()) && d >= start && d <= end) return true;
  }
  for (const [f, l] of ev.leases) {
    if (f <= end && l >= start) return true;
  }
  return false;
}
