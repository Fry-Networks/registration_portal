/**
 * Bounded, explainable wallet signing for the verification-stake modal (B24).
 *
 * components/modals/StakeVerification.tsx used to show the "Signature required" toast and then
 * await the asset-balance lookup, the transaction build and the wallet signature with no time
 * bound on any of them. algosdk's fetch has no timeout and lib/algorand/withRetry.ts only retries
 * errors -- it cannot rescue a promise that never settles -- so a half-open WalletConnect session
 * left the modal awaiting forever. Because the spinner was only cleared in a `finally` block, both
 * tier buttons stayed on "Processing..." indefinitely while the wallet had never been asked for
 * anything.
 *
 * components/SignIn.tsx already made this exact call for the sign-in flow (SIGN_IN_TIMEOUT_MS =
 * 45_000, "never leave the user on an infinite Authenticating... spinner"). Its helpers are
 * module-local and that component is outside this change's scope, so the same contract is
 * expressed here for the staking path rather than refactored out of it.
 *
 * Timeout budget, chosen so the whole flow stays inside the 120s bound the fix requires:
 *   4 preflight steps (fees, balance, precheck, build) at 12s + signing at 60s
 *   = 108s worst case before the modal is handed back to the user with a specific reason.
 */

import { getAlgodClient } from './clients';

/** Raised when a bounded step produced no answer in time. Distinguishable from a wallet error. */
export class StakeTimeoutError extends Error {
  constructor(public readonly step: string) {
    super(`STAKE_TIMEOUT:${step}`);
    this.name = 'StakeTimeoutError';
  }
}

/** Cap for the network reads that must happen before a signature can be requested. */
export const STAKE_PREFLIGHT_TIMEOUT_MS = 12_000;

/**
 * The smallest spendable balance that can still pay one minimum network fee.
 *
 * NOT the same test as lib/algorand/balances.ts `getAlgoBalance`, which returns the account's TOTAL
 * balance. Fry accounts are routinely funded to exactly their min-balance, and for such an account
 * getAlgoBalance reports a healthy-looking figure (1.4 ALGO for a real one seen in the logs) while
 * the spendable balance is 0. Every microALGO of min-balance is locked, so the fee cannot be paid
 * and algod rejects the transfer AFTER the user has already signed it.
 */
export const MIN_FEE_HEADROOM_MICROALGO = 1_000;

interface AccountFunding {
  amountMicros: number;
  minBalanceMicros: number;
  spendableMicros: number;
}

/**
 * Spendable = amount - min-balance, read straight from algod.
 *
 * Both key spellings are accepted because algosdk 3.x returns camelCase models while the REST
 * payload (and the same-origin proxy that serves it) uses the hyphenated names.
 */
export async function getAccountFunding(address: string): Promise<AccountFunding> {
  const info = await getAlgodClient().accountInformation(address).do();
  // algosdk 3.x decodes into a typed Account whose figures are bigint; the double cast reads the
  // hyphenated REST spelling as a fallback without asserting the two shapes overlap.
  const raw = info as unknown as Record<string, unknown>;
  const amountMicros = Number(raw.amount ?? 0);
  const minBalanceMicros = Number(raw.minBalance ?? raw['min-balance'] ?? 0);
  return {
    amountMicros,
    minBalanceMicros,
    spendableMicros: amountMicros - minBalanceMicros
  };
}

/** Formats microALGO as ALGO for a user-facing message, without trailing-zero noise. */
export function formatAlgo(micros: number): string {
  return `${Number((micros / 1_000_000).toFixed(6))}`;
}

/** Cap for the wallet signature itself, the step a stale WalletConnect session can hang on. */
export const STAKE_SIGN_TIMEOUT_MS = 60_000;

/**
 * Resolves `promise`, or rejects with StakeTimeoutError after `ms`.
 *
 * The underlying promise is not cancellable -- nothing in the wallet SDKs offers that -- so a late
 * settlement is deliberately ignored rather than surfaced to a caller that has already moved on.
 */
export function withStakeTimeout<T>(
  promise: Promise<T>,
  ms: number,
  step: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new StakeTimeoutError(step)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

const MAX_STAKE_ERROR_LEN = 160;

/** Per-step guidance for a timeout, so the user is told what to do rather than just that it failed. */
export const STAKE_TIMEOUT_MESSAGES: Record<string, string> = {
  fees:
    'Could not check your ALGO balance for network fees in time. The Algorand node may be busy — wait a moment and try again.',
  balance:
    'Could not read your FRY 2.0 balance in time. The Algorand node may be busy — wait a moment and try again.',
  precheck:
    'The staking service did not respond in time. Wait a moment and try again.',
  build:
    'Could not prepare the staking transaction in time. The Algorand node may be busy — wait a moment and try again.',
  signing:
    'No response from your wallet within 60 seconds. Open your wallet app (Pera / Defly / GoPlausible), approve or dismiss the pending request, then start the stake again.',
  default: 'The staking request timed out. Nothing was sent — you can try again.'
};

/**
 * Condenses a thrown value into a short, user-safe sentence.
 *
 * Wallet SDKs carry the detail that actually helps ("the user has rejected the transaction
 * request", "Session currently disconnected", "PeraWalletConnect was not initialized correctly",
 * and algod's "underflow on subtracting ... from sender amount"). All of it used to be discarded
 * into console.error behind one "Error sending transaction. Please contact us" callout.
 */
export function describeStakeError(error: unknown): string {
  if (error instanceof StakeTimeoutError) {
    return STAKE_TIMEOUT_MESSAGES[error.step] ?? STAKE_TIMEOUT_MESSAGES.default;
  }

  let raw: string;
  if (error instanceof Error) {
    raw = error.message;
  } else if (typeof error === 'string') {
    raw = error;
  } else if (error === null || error === undefined) {
    raw = '';
  } else {
    try {
      raw = JSON.stringify(error);
    } catch {
      raw = '';
    }
  }

  const trimmed = (raw || '').trim();
  // "{}" is what JSON.stringify yields for a thrown object carrying only non-enumerable fields;
  // it is no more useful to a user than an empty string.
  if (!trimmed || trimmed === '{}') {
    return 'Unknown wallet error.';
  }
  return trimmed.length > MAX_STAKE_ERROR_LEN
    ? `${trimmed.slice(0, MAX_STAKE_ERROR_LEN)}…`
    : trimmed;
}

/**
 * True only for an amount that can be turned into a real on-chain transfer.
 *
 * /api/stake-amount returns `product.reward.stake` verbatim and falls back to
 * `{ stake_one: 0, stake_two: 0 }` when a product carries no stake figure, and the BYOD branch
 * halves whatever it received. A missing field therefore reaches the builder as undefined/NaN,
 * which would otherwise be multiplied into the asset amount.
 */
export function isValidStakeAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
