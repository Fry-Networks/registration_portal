import type { Db } from 'mongodb';

// Shared ownership resolver — mirrors pages/api/devices/list.ts / status-summary.ts:
// a device is owned by `owner` if its address matches OR its user_id matches the
// registration-users _id (stored as ObjectId or string). No-address devices never match.
export async function ownershipQuery(db: Db, owner: string): Promise<{ $or: any[] }> {
  const userDoc = await db
    .collection('registration-users')
    .findOne({ address: owner }, { projection: { _id: 1 } });
  const userObjectId = userDoc?._id;
  const userIdString = userDoc?._id?.toString();
  const clauses: any[] = [{ address: owner }];
  if (userObjectId) clauses.push({ user_id: userObjectId });
  if (userIdString && userIdString !== userObjectId?.toString()) clauses.push({ user_id: userIdString });
  return { $or: clauses };
}

export function devicesCollectionName(): string {
  return process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-devices' : 'devices';
}
