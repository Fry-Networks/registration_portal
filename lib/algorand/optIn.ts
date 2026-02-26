// Added dedicated helper utilities for ASA opt-in enforcement so APIs can fail fast
// with actionable guidance instead of letting Algorand reject transfers mid-flight.
import { getAssetBalance } from './balances';
import { getAssetDisplay } from '../utils';
import { createApiError, ErrorCodes } from '../api-errors';

/**
 * Ensures the provided wallet address has opted into the specified asset.
 * Throws a standardized API error when the asset is missing so callers can
 * present actionable UI (or short-circuit custodial sends).
 */
export const ensureWalletAssetOptIn = async (
  walletAddress: string,
  assetId: string | number,
  operation: string
): Promise<void> => {
  if (!walletAddress || assetId === 'none') {
    return;
  }

  const normalizedAssetId = String(assetId);
  const balance = await getAssetBalance(walletAddress, normalizedAssetId);
  if (balance === null) {
    const assetLabel = getAssetDisplay(normalizedAssetId);
    throw {
      status: 400,
      response: createApiError(
        ErrorCodes.WALLET_ASSET_NOT_OPTED_IN,
        `${assetLabel} must be opted into before ${operation}.`,
        `Open the wallet ${walletAddress} and opt into ${assetLabel}, then retry.`,
        { assetId: normalizedAssetId, walletAddress, operation }
      )
    };
  }
};
