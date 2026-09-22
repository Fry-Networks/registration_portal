/**
 * Actionable copy for /convert failures.
 *
 * Both conversion modals used to render one generic "Network error ..." toast for every
 * non-ok response, so a wallet with no conversion snapshot (404), a wallet that differs
 * from the signed-in session (401), an ineligible wallet (403) and a transient algod
 * failover failure (503) all looked identical to the user and to support.
 *
 * Pure: no React, no fetch, no logging. The caller owns the toast and the log payload.
 */

export interface ConversionErrorCopy {
  heading: string;
  message: string;
}

const GENERIC: ConversionErrorCopy = {
  heading: 'Conversion Error',
  message:
    'We could not start the conversion. Please try again in a few minutes. If it keeps happening, contact support and quote the error code shown in your browser console.',
};

const NO_CONVERSION_ACCOUNT: ConversionErrorCopy = {
  heading: 'No Conversion Account',
  message:
    'We could not find a conversion account for this wallet. Only wallets that held FRY 1.0 at the snapshot are eligible. If you believe this is wrong, contact support with your wallet address.',
};

const WALLET_MISMATCH: ConversionErrorCopy = {
  heading: 'Wallet Mismatch',
  message:
    'The connected wallet does not match your signed-in session. Please disconnect and reconnect using the wallet you signed in with, then try again.',
};

const SESSION_EXPIRED: ConversionErrorCopy = {
  heading: 'Session Expired',
  message: 'Your session has expired. Please sign in again to continue the conversion.',
};

const NOT_ELIGIBLE: ConversionErrorCopy = {
  heading: 'Not Eligible',
  message:
    'This wallet is not eligible for this conversion. If you expected to be eligible, contact support with your wallet address.',
};

const CHAIN_LOOKUP: ConversionErrorCopy = {
  heading: 'Temporarily Unavailable',
  message:
    'We could not reach the Algorand network to verify your on-chain balance. This is temporary — please try again in a few minutes.',
};

/**
 * Maps an HTTP status (and the optional `code` from lib/api-errors) to user-facing copy.
 * Unknown statuses fall back to one shared generic message.
 */
export function conversionErrorMessage(
  status?: number,
  code?: string
): ConversionErrorCopy {
  switch (status) {
    case 404:
      return NO_CONVERSION_ACCOUNT;
    case 401:
      return code === 'SESSION_REQUIRED' || code === 'SESSION_EXPIRED'
        ? SESSION_EXPIRED
        : WALLET_MISMATCH;
    case 403:
      return NOT_ELIGIBLE;
    case 503:
      return CHAIN_LOOKUP;
    default:
      return GENERIC;
  }
}

/**
 * 503 means the algod failover balance lookup failed, which is transient and safe to
 * repeat: ONLY idempotent read endpoints may use this. Conversion submit/verify POSTs
 * (burn, claim, reconcile) must never be retried automatically — a repeat can double-spend.
 */
export function shouldRetryConversionRead(status?: number): boolean {
  return status === 503;
}
