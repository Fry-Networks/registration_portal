import type { Db } from 'mongodb';

// Shared ownership resolver — mirrors pages/api/devices/list.ts / status-summary.ts:
// a device is owned by `owner` if its address matches. No-address devices never match.
export async function ownershipQuery(db: Db, owner: string): Promise<{ $or: any[] }> {
  return { $or: [{ address: owner }] };
}

export function devicesCollectionName(): string {
  return process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-devices' : 'devices';
}
