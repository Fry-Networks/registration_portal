import { getClientToken } from './clientToken';
import { generateRequestSignatureAsync } from './requestSignature.client';

export type ConfirmWatcherOptions = {
  maxAttempts?: number;
  onAttempt?: (attempt: number, nextDelayMs: number) => void;
  onTimeout?: () => void;
};

// Starts a background confirmation watcher for a txId. Returns a cancel function.
export function startConfirmationWatcher(
  txId: string,
  onConfirmed: () => Promise<void> | void,
  opts: ConfirmWatcherOptions = {}
) {
  let cancelled = false;
  let attempt = 0;
  const maxAttempts = opts.maxAttempts ?? 60; // ~few minutes with backoff

  const nextDelay = (n: number) => {
    if (n < 10) return 1000; // first 10 attempts every 1s
    if (n < 25) return 2000; // next 15 attempts every 2s
    if (n < 45) return 4000; // next 20 attempts every 4s
    return 8000; // last attempts every 8s
  };

  const tick = async () => {
    if (cancelled) return;
    try {
      const clientToken = await getClientToken();
      const payload = { txId };
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = await generateRequestSignatureAsync(
        'POST',
        '/api/rewards/confirm',
        payload,
        timestamp
      );

      const res = await fetch('/api/rewards/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': clientToken,
          'x-request-signature': signature,
          'x-request-timestamp': timestamp.toString()
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      if (res.ok && json.success) {
        await onConfirmed();
        return;
      }
    } catch {}

    attempt++;
    if (attempt >= maxAttempts) {
      opts.onTimeout?.();
      return;
    }
    const delay = nextDelay(attempt);
    opts.onAttempt?.(attempt, delay);
    setTimeout(tick, delay);
  };

  // start immediately
  const delay0 = nextDelay(0);
  opts.onAttempt?.(attempt, delay0);
  setTimeout(tick, delay0);

  return () => {
    cancelled = true;
  };
}
