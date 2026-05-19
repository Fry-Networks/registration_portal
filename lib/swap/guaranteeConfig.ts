/**
 * Guarantee feature configuration.
 *
 * IMPORTANT: All values read via getter functions, not module-level constants.
 * Next.js inlines process.env at build time for module-level code.
 * Getters ensure runtime env vars (from docker-compose) are used.
 */

export function isGuaranteeEnabled(): boolean {
  return process.env.GUARANTEE_ENABLED === 'true';
}

export function isGuaranteePaused(): boolean {
  return process.env.GUARANTEE_PAUSED === 'true';
}

export function getApprovedSources(): number[] {
  return (process.env.GUARANTEE_APPROVED_SOURCES || '0,31566704,312769').split(',').map(Number);
}

export function getAllowedTargetAssets(): number[] {
  return (process.env.GUARANTEE_ALLOWED_TARGET_ASSETS || '2485314946').split(',').map(Number);
}

export function getMinLpUsd(): number {
  return Number(process.env.GUARANTEE_MIN_LP_USD) || 10;
}

export function getQuoteTtlSec(): number {
  return Number(process.env.GUARANTEE_QUOTE_TTL_SECONDS) || 30;
}

export function getSwapDeadlineSec(): number {
  return Number(process.env.GUARANTEE_SWAP_DEADLINE_SECONDS) || 120;
}

export function getSettlementDeadlineSec(): number {
  return Number(process.env.GUARANTEE_SETTLEMENT_DEADLINE_SECONDS) || 600;
}

export function getMaxTopupPerSwap(): bigint {
  return BigInt(process.env.GUARANTEE_MAX_TOPUP_PER_SWAP || '50000000000');
}

export function getMaxTopupPerWalletDay(): bigint {
  return BigInt(process.env.GUARANTEE_MAX_TOPUP_PER_WALLET_DAY || '500000000000');
}

export function getMaxTopupGlobalDay(): bigint {
  return BigInt(process.env.GUARANTEE_MAX_TOPUP_GLOBAL_DAY || '5000000000000');
}

export function getVaultAppId(): number {
  return Number(process.env.GUARANTEE_VAULT_APP_ID) || 0;
}

// Settlement signer env var names
export const GUARANTEE_MNEMONIC_ENV = 'GUARANTEE_MNEMONIC';
export const GUARANTEE_REKEY_ENV = 'GUARANTEE_REKEY';
