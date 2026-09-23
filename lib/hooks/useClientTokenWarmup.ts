/**
 * Session-gated warm-up of the L1 client-token cache (CLIENT-SIDE ONLY).
 *
 * R12b: pages/_app.tsx warmed the cache from a mount-once effect that ran before any session
 * existed. Pre-R12 the L1 value was computed locally, so a signed-out visitor made no network call
 * at all. After R12 getClientToken() fetches GET /api/auth/signing-key, which answers
 * 401 SESSION_REQUIRED without a session -- so every ANONYMOUS page load produced a failed request
 * plus a "[ClientToken] Failed to resolve token" console warning.
 *
 * The token is derived from the session, so warming it before one exists cannot succeed. The
 * warm-up is therefore gated on the NextAuth status. Token resolution itself is unchanged for
 * signed-in users: the first authenticated render still fills the cache exactly once.
 */
import { useEffect } from 'react';

import { getClientToken } from '../clientToken';

export function shouldWarmClientToken(status: string | null | undefined): boolean {
  return status === 'authenticated';
}

export function useClientTokenWarmup(status: string | null | undefined): void {
  useEffect(() => {
    if (!shouldWarmClientToken(status)) return;

    let cancelled = false;
    void (async () => {
      try {
        await getClientToken();
      } catch (error) {
        if (!cancelled) {
          console.error('[ClientToken] Failed to warm token cache', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);
}
