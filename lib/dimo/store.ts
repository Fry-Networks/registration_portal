import type { Collection, Document, UpdateFilter, Filter } from 'mongodb';
import clientPromise from '../mongoclient';
import { hashDimoId, type DimoConfig, type NormalizedSubscription } from './config';
import { evaluateEligibility } from './eligibility';

const resolveCollectionName = () => {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE && process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  return testMode ? 'test-dimo-subscriptions' : 'dimo-subscriptions';
};

const getCollection = async (): Promise<Collection<StoredSubscription>> => {
  const client = await clientPromise;
  const db = client.db('main');
  return db.collection<StoredSubscription>(resolveCollectionName());
};

export type StoredSubscription = {
  dimo_subscription_id: string;
  dimo_user_id_hash: string;
  wallet_address: string;
  dimo_email?: string | null;
  plan: string;
  status: string;
  started_at: Date;
  renewal_at?: Date | null;
  // Persist trial end so we can audit trialing_incomplete eligibility decisions.
  trial_ends_at?: Date | null;
  grace_expires_at?: Date | null;
  eligible: boolean;
  eligibility_reason: string;
  device_address?: string | null;
  device_token_id?: string | number | null;
  device_token_did?: string | null;
  device_serial?: string | null;
  device_vehicle_token_id?: string | number | null;
  device_vehicle_definition?: Record<string, unknown> | null;
  device_claimed_at?: Date | null;
  device_manufacturer?: string | null;
  miner_key_hash?: string;
  miner_key_checksum?: string;
  claimed_at?: Date;
  payload_sig?: string;
  audit?: Array<Record<string, unknown>>;
  created_at?: Date;
  updated_at?: Date;
};

/**
 * Upserts the DIMO subscription snapshots and eligibility verdicts.
 */
export const upsertSubscriptions = async (params: {
  subs: NormalizedSubscription[];
  walletAddress: string;
  config: DimoConfig;
  dimoUserId?: string;
  dimoEmail?: string | null;
  encryptKey?: (plain: string) => string;
}): Promise<void> => {
  const collection = await getCollection();
  const now = new Date();

  for (const sub of params.subs) {
    if (!sub.subscriptionId || sub.subscriptionId.trim().length === 0) {
      continue; // skip malformed entries with no subscription id
    }
    const eligibility = evaluateEligibility(sub, params.config);
    const dimoSubscriptionId = sub.subscriptionId;
    const resolvedUserId = (sub.userId || params.dimoUserId || '').toString().trim();
    if (!resolvedUserId) {
      const missingErr = new Error('Missing DIMO user identifier from account payload');
      (missingErr as any).code = 'DIMO_USER_ID_MISSING';
      throw missingErr;
    }
    const dimoUserIdHash = hashDimoId(resolvedUserId, params.config.hashSecret);
    const payloadSig = hashDimoId(JSON.stringify(sub.raw ?? {}), params.config.hashSecret);

    const existingUserBinding = await collection.findOne({
      dimo_user_id_hash: dimoUserIdHash,
      wallet_address: { $ne: params.walletAddress }
    });
    if (existingUserBinding) {
      const conflictError = new Error('DIMO account already bound to a different wallet');
      (conflictError as any).code = 'DIMO_USER_CONFLICT';
      throw conflictError;
    }

    const existing = await collection.findOne({ dimo_subscription_id: dimoSubscriptionId });
    if (existing?.wallet_address && existing.wallet_address !== params.walletAddress) {
      const conflictError = new Error('DIMO subscription already bound to a different wallet');
      (conflictError as any).code = 'DIMO_WALLET_CONFLICT';
      throw conflictError;
    }

    const updateDoc: UpdateFilter<StoredSubscription> = {
      $set: {
        dimo_subscription_id: dimoSubscriptionId,
        dimo_user_id_hash: dimoUserIdHash,
        wallet_address: params.walletAddress,
        dimo_email: params.dimoEmail ?? null,
        plan: sub.plan,
        status: sub.status,
        started_at: sub.startedAt,
        renewal_at: sub.renewalAt ?? null,
        // Store trial end for diagnostics and future UX needs.
        trial_ends_at: sub.trialEndsAt ?? null,
        grace_expires_at: eligibility.graceExpiresAt ?? null,
        eligible: eligibility.eligible,
        eligibility_reason: eligibility.reason,
        device_address: sub.deviceAddress ?? null,
        device_token_id: sub.deviceTokenId ?? null,
        device_token_did: sub.deviceTokenDid ?? null,
        device_serial: sub.deviceSerial ?? null,
        device_vehicle_token_id: sub.vehicleTokenId ?? null,
        device_vehicle_definition: sub.vehicleDefinition ?? null,
        device_claimed_at: sub.deviceClaimedAt ?? null,
        device_manufacturer: sub.deviceManufacturer ?? null,
        payload_sig: payloadSig,
        updated_at: now
      },
      $setOnInsert: {
        created_at: now
      },
      $push: {
        audit: {
          $each: [
            {
              event: 'synced',
              at: now,
              meta: {
                plan: sub.plan,
                status: sub.status,
                eligibility: eligibility.reason
              }
            }
          ]
        }
      }
    };

    const filter: Filter<StoredSubscription> = {
      wallet_address: params.walletAddress,
      $or: [
        { dimo_subscription_id: dimoSubscriptionId },
        { dimo_subscription_id: { $in: ['', 'null'] }, payload_sig: payloadSig }
      ]
    };

    await collection.updateOne(filter, updateDoc, { upsert: true });
  }
};

export const findEligibleSubscriptions = async (walletAddress: string): Promise<StoredSubscription[]> => {
  const collection = await getCollection();
  const cursor = collection
    .find<StoredSubscription>({
      wallet_address: walletAddress,
      eligible: true
    })
    .sort({ started_at: 1 });
  return cursor.toArray();
};

// Return all subscriptions so the UI can show ineligible entries too.
export const findSubscriptionsByWallet = async (walletAddress: string): Promise<StoredSubscription[]> => {
  const collection = await getCollection();
  const cursor = collection
    .find<StoredSubscription>({
      wallet_address: walletAddress
    })
    .sort({ started_at: 1 });
  return cursor.toArray();
};

export const findSubscriptionById = async (
  walletAddress: string,
  subscriptionId: string
): Promise<StoredSubscription | null> => {
  const collection = await getCollection();
  return collection.findOne<StoredSubscription>({
    wallet_address: walletAddress,
    dimo_subscription_id: subscriptionId
  });
};

export const markSubscriptionClaimed = async (params: {
  walletAddress: string;
  subscriptionId: string;
  minerKeyHash: string;
  minerKeyChecksum: string;
}): Promise<void> => {
  const collection = await getCollection();
  const now = new Date();
  const updateDoc: UpdateFilter<StoredSubscription> = {
    $set: {
      miner_key_hash: params.minerKeyHash,
      miner_key_checksum: params.minerKeyChecksum,
      claimed_at: now,
      updated_at: now
    },
    $unset: {
      miner_key: '',
      miner_key_ciphertext: ''
    },
    $push: {
      audit: {
        $each: [
          {
            event: 'claimed',
            at: now,
            meta: {
              miner_key_checksum: params.minerKeyChecksum
            }
          }
        ]
      }
    }
  };

  await collection.updateOne(
    {
      wallet_address: params.walletAddress,
      dimo_subscription_id: params.subscriptionId
    },
    updateDoc
  );
};
