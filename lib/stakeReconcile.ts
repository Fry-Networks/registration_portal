import type { Device } from './types';
import { FRY_1 } from './utils';
import { isLegacyVerificationStake } from './legacyStake';

const FRY1_ASSET_ID = String(FRY_1.id);

/**
 * `verified` is only ever written by /api/stake/verification, which fires at stake time.
 * A device whose document was created AFTER its stake already existed never had that
 * endpoint run for it, so the flag stayed false even though the stake is real and current.
 * A document that already carries a complete, current, non-legacy stake is verified by
 * definition — the stake record IS the verification — so reconcile it on read.
 */
export const shouldReconcileVerified = (device?: Device | null): boolean => {
  if (!device || device.verified) return false;

  // Legacy stakes are force-unverified elsewhere; never fight that path.
  if (isLegacyVerificationStake(device)) return false;

  const stake = device.staked;
  if (!stake) return false;

  // A recorded withdrawal means the stake is gone, not pending verification.
  if (stake.lastWithdrawal) return false;

  const amount = typeof stake.amount === 'number' ? stake.amount : null;
  if (!amount || amount <= 0) return false;
  if (!stake.time) return false;
  if (typeof stake.txId !== 'string' || stake.txId.length === 0) return false;

  // migrate-stake-history nulls asset_id for withdrawn stakes, and FRY 1.0 stakes are
  // excluded from verification by design.
  const assetId = stake.asset_id != null ? String(stake.asset_id) : null;
  if (!assetId || assetId === FRY1_ASSET_ID) return false;

  return true;
};
