/**
 * Bound an await that depends on something outside our control.
 *
 * The claim flow waits on a wallet: the user's phone has to wake, show a prompt and
 * answer it, and the WalletConnect relay has to carry all of that back. Any of those
 * can simply never happen — a dismissed prompt, a dead relay, a phone in a pocket —
 * and the promise then never settles. Without a bound the dialog sits on "Paying
 * network fee..." forever with its Close button disabled, which is what users saw.
 *
 * Nothing here cancels the underlying work: a signature that arrives after the deadline
 * is still a valid signature, and the caller is expected to check the chain before
 * asking for a second one rather than assuming the first never happened.
 */
export class WalletTimeoutError extends Error {
  readonly timedOutAfterMs: number;
  readonly operation: string;
  constructor(operation: string, timedOutAfterMs: number) {
    super(`${operation} did not respond within ${Math.round(timedOutAfterMs / 1000)}s`);
    this.name = 'WalletTimeoutError';
    this.operation = operation;
    this.timedOutAfterMs = timedOutAfterMs;
  }
}

export const WALLET_SIGN_TIMEOUT_MS = 90_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, operation: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new WalletTimeoutError(operation, ms)), ms);
  });
  // finally, not then: the timer must be cleared on rejection too, or a failed claim
  // leaves a 90s handle behind and the original error is still what surfaces.
  return Promise.race([promise, bound]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}
