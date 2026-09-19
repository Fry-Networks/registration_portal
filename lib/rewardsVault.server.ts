// SERVER-ONLY: contains an algosdk.mnemonicToSecretKey derivation over REWARD_MNEMONIC.
// Must never be imported by a client page or component. lib/utils.ts is imported by 12+ client
// files, which is exactly why this was moved out of it -- a NEXT_PUBLIC_-prefixed rename of the
// env var there would have inlined a custodial signing key into the browser bundle.
// Naming follows the existing lib/requestSignature.server.ts convention.
import algosdk from 'algosdk';
import { REWARD_WALLET } from './utils';

/**
 * Returns the on-chain address of the rewards vault used by server-side senders.
 * If REWARD_MNEMONIC is present, derive the address to avoid mismatches when
 * vault keys rotate. Falls back to the static constant.
 */
export const getRewardsVaultAddress = (): string => {
  try {
    // Highest priority: explicit configured address
    const configured = process.env.REWARDS_VAULT_ADDR as string | undefined;
    if (configured && configured.trim().length > 0) {
      return configured.trim();
    }

    const m = process.env.REWARD_MNEMONIC as string | undefined;
    if (m && m.length > 0) {
      const acc = algosdk.mnemonicToSecretKey(m);
      // Always return a primitive string regardless of SDK Address typing.
      return String(acc.addr);
    }
  } catch (e) {
    // ignore and fall back
  }
  return REWARD_WALLET;
};
