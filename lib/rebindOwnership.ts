import type { MongoClient } from 'mongodb';

/**
 * RC1 (r12, 2026-09-22) — ownership proof for rebinding a device-wallet-clobbered
 * registration.
 *
 * The July premature binding (pre-F2 hardwareapi) bound installs to the device's OWN
 * Algorand wallet, leaving 22 of 20,049 main.devices docs with
 *   address === reward_wallet === device_algo_address
 * Such a doc resolves to no owner: pages/devices.tsx lists by {address: session wallet},
 * so the rightful owner cannot see it, and both registration routes refused to rebind it.
 *
 * The carve-out that lets the owner recover it must NOT be satisfiable by miner-key
 * possession alone — install keys circulate in Discord support threads. The proof used
 * here is creds.hardware.address: the wallet that registered the key at install time,
 * which the clobber never touched. A clobbered device with no creds.hardware record is
 * therefore NOT self-rebindable (14 of the 22 measured 2026-09-22); those need support.
 */

const CREDS_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const CREDS_HARDWARE_COLLECTION = process.env.MONGO_CREDS_COLLECTION ?? 'hardware';
const FEM_KEY_PATTERN = /^FEM-[A-Za-z0-9]{32}$/;

const trimmed = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/**
 * The two fields the clobber test reads. Callers pass `unknown` shapes (a Mongo
 * WithId<Document> from one route, a typed Device from another), so the narrowing happens
 * here rather than forcing a cast at every call site.
 */
type RebindCandidate = {
  address?: unknown;
  device_algo_address?: unknown;
};

/** True when the doc's bound wallet IS the device's own wallet (the July clobber state). */
export function isDeviceWalletClobber(device: unknown): boolean {
  if (!device || typeof device !== 'object') return false;
  const doc = device as RebindCandidate;
  const boundAddress = trimmed(doc.address);
  const deviceWallet = trimmed(doc.device_algo_address);
  return boundAddress.length > 0 && boundAddress === deviceWallet;
}

/**
 * The wallet creds.hardware recorded for this miner key at install time, or null.
 * Projects ONLY the address: creds.hardware also carries the device credential blob.
 */
export async function credsHardwareOwnerAddress(
  client: MongoClient,
  minerKey: string | null | undefined
): Promise<string | null> {
  const key = trimmed(minerKey);
  if (!key) return null;
  const collection = client.db(CREDS_DB_NAME).collection(CREDS_HARDWARE_COLLECTION);
  let record = await collection.findOne(
    { miner_key: key },
    { projection: { address: 1, _id: 0 } }
  );
  if (!record && FEM_KEY_PATTERN.test(key)) {
    // FEM 0.2.x clients generated lowercase-hex keys while the app displayed them
    // uppercased, mirroring the case-insensitive lookup both registration routes do.
    record = await collection.findOne(
      { miner_key: { $regex: '^' + key + '$', $options: 'i' } },
      { projection: { address: 1, _id: 0 } }
    );
  }
  const owner = trimmed(record?.address);
  return owner.length > 0 ? owner : null;
}

/**
 * The only gate that may relax an owner-mismatch refusal: the doc is in the clobber state
 * AND the session wallet is the wallet that installed the key. Anything else is false.
 */
export async function mayRebindClobberedDevice(
  client: MongoClient,
  device: unknown,
  minerKey: string | null | undefined,
  sessionAddress: string | null | undefined
): Promise<boolean> {
  const wallet = trimmed(sessionAddress);
  if (!wallet) return false;
  if (!isDeviceWalletClobber(device)) return false;
  const owner = await credsHardwareOwnerAddress(client, minerKey);
  return owner !== null && owner === wallet;
}

export const REBIND_NOTE =
  'RC1 self-service rebind: address/reward_wallet had been clobbered to the device wallet ' +
  'by the July premature binding; restored to the creds.hardware registration wallet.';

/** The metadata every rebind write records, so the pre-image stays recoverable. */
export function rebindMetadata(
  previousAddress: string,
  at: Date = new Date()
): { rebound_from: string; rebind_note: string; rebind_at: Date } {
  return {
    rebound_from: previousAddress,
    rebind_note: REBIND_NOTE,
    rebind_at: at,
  };
}
