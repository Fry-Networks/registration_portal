// ===========================================================================
// COLLECTION-NAMING GOTCHA: three different things are called 'PoC hardware'.
// Verified against the live ARES00 MongoDB on 2026-09-22 with getCollectionNames().
//
//   (a) THE PoC EVIDENCE STORE -- the PoC *database*:
//         client.db('PoC').collection('hardware')        <- heartbeats, reward date-keys
//         client.db('PoC').collection('installations')   <- leases
//       Read by THIS FILE, by lib/deviceActivity.ts (all three liveness tiers) and
//       written by lib/poc-hardware.ts. This is the only 'PoC hardware' that carries
//       evidence.
//
//   (b) A DEAD LOOKUP -- client.db('main').collection('PoC') in
//       pages/api/hardware/status.ts:83-108, whose comment calls it 'main.PoC.hardware'.
//       Database 'main' has NO collection named 'PoC'. See the note at that call site.
//
//   (c) THE CREDENTIALS STORE -- a different database, same collection NAME:
//         client.db(MONGO_CREDS_DB ?? 'creds')
//               .collection(MONGO_CREDS_COLLECTION ?? 'hardware')
//       Read by pages/api/my-keys.ts (CRED_COLLECTIONS[0] === 'hardware'),
//       pages/api/hardware/status.ts and pages/api/hardware/register.ts. It holds
//       provisioning credentials, not evidence.
//
// So the bare name 'hardware' is ambiguous in this repo: always name the database
// with it (PoC.hardware vs creds.hardware vs main.hardware).
//
// LOOK-ALIKES -- a collection-name scan by pattern will pick up backups and fixtures.
// Live on ARES00 as of 2026-09-22:
//   db PoC  : hardware, installations, measurements, merkle_trees, versions, presearch,
//             mysterium, PLUS the stale copies hardware_backup and
//             versions_backup_20260819.
//   db main : poc_reward_dailies (the real one) sitting next to the fixture
//             test_poc_reward_dailies and the singular poc_reward_daily; plus a
//             main.hardware collection that is neither (a) nor (c).
// Match collection names exactly; never with /poc/i or /hardware/.
// ===========================================================================
import type { MongoClient } from 'mongodb';

// Forward PoC evidence guard for the claim path — mirror of push_distribute_v2 `poc_in_window`:
// a device is evidenced for a window if PoC.hardware has a reward date-key inside it, OR a
// PoC.installations lease (first_installed_at..last_seen_at) overlaps it.
export type Evidence = { dates: Set<string>; leases: Array<[Date, Date]> };

export const emptyEvidence = (): Evidence => ({ dates: new Set<string>(), leases: [] });

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

// Same evidence, loaded for many devices in two queries instead of 2N. The reward-summary
// endpoints have to apply the identical A-gate the claim path applies (otherwise the dashboard
// advertises a claimable total the claim endpoint then refuses), and a per-device round trip
// would be ~150 queries for a large operator.
export async function loadEvidenceBatch(
  client: MongoClient,
  minerKeys: string[]
): Promise<Map<string, Evidence>> {
  const out = new Map<string, Evidence>();
  const keys = minerKeys.filter((k): k is string => typeof k === 'string' && k.length > 0);
  if (keys.length === 0) return out;
  for (const k of keys) out.set(k, emptyEvidence());

  const poc = client.db('PoC');

  const hw = await poc
    .collection('hardware')
    .find({ miner_key: { $in: keys } }, { projection: { miner_key: 1, rewards: 1 } })
    .toArray();
  for (const doc of hw) {
    const ev = out.get(String(doc.miner_key));
    if (!ev) continue;
    if (doc?.rewards && typeof doc.rewards === 'object') {
      for (const k of Object.keys(doc.rewards)) ev.dates.add(k);
    }
  }

  const inst = await poc
    .collection('installations')
    .find(
      { miner_key: { $in: keys } },
      { projection: { miner_key: 1, first_installed_at: 1, last_seen_at: 1 } }
    )
    .toArray();
  for (const i of inst) {
    const ev = out.get(String(i.miner_key));
    if (!ev) continue;
    const f = i.first_installed_at ? new Date(i.first_installed_at) : null;
    const l = i.last_seen_at ? new Date(i.last_seen_at) : null;
    if (f && l && !isNaN(f.getTime()) && !isNaN(l.getTime())) ev.leases.push([f, l]);
  }

  return out;
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
