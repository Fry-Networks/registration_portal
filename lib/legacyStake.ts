import { Device } from './types';
import { FRY_1 } from './utils';

const PUBLIC_FORCE =
  process.env.NEXT_PUBLIC_LEGACY_VERIFICATION_FORCE_UTC ||
  process.env.LEGACY_VERIFICATION_FORCE_UTC;

const LEGACY_FORCE_TIMESTAMP =
  typeof PUBLIC_FORCE === 'string' && PUBLIC_FORCE.trim().length > 0
    ? Date.parse(PUBLIC_FORCE)
    : null;

const FRY1_ASSET_ID = String(FRY_1.id);

export const getLegacyForceTimestamp = (): number | null => LEGACY_FORCE_TIMESTAMP;

export const isLegacyVerificationStake = (device?: Device | null): boolean => {
  if (!device?.legacy_stake_unlocked) return false;
  const stake = device.staked;
  if (!stake) return false;
  const amount = typeof stake.amount === 'number' ? stake.amount : null;
  if (!amount || amount <= 0) return false;
  if (!stake.time) return false;
  const assetId =
    typeof stake.asset_id === 'number' || typeof stake.asset_id === 'string'
      ? String(stake.asset_id)
      : null;
  return !assetId || assetId === FRY1_ASSET_ID;
};

export const getLegacyStakeAssetId = (device?: Device | null): string | null => {
  if (!isLegacyVerificationStake(device)) return null;
  const assetId =
    typeof device?.staked?.asset_id === 'number' || typeof device?.staked?.asset_id === 'string'
      ? String(device.staked.asset_id)
      : null;
  return assetId ?? FRY1_ASSET_ID;
};

export const shouldForceLegacyUnverified = (device?: Device | null): boolean => {
  if (!isLegacyVerificationStake(device)) return false;
  if (!LEGACY_FORCE_TIMESTAMP) return false;
  return Date.now() >= LEGACY_FORCE_TIMESTAMP;
};
