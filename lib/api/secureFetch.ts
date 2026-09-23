import { getClientToken, refreshClientToken } from '../clientToken';
import {
  generateRequestSignatureAsync,
  recoverFromSignatureRejection
} from '../requestSignature.client';
import { getServerTimestamp } from '../serverTime';

type JsonValue = Record<string, unknown> | Array<unknown> | string | number | boolean | null;

export interface SecureFetchOptions extends RequestInit {
  method?: string;
}

export const secureFetch = async (
  endpoint: string,
  payload: JsonValue,
  options: SecureFetchOptions = {}
): Promise<Response> => {
  if (typeof window === 'undefined') {
    throw new Error('secureFetch can only be used in the browser');
  }

  const method = options.method ?? 'POST';

  let clientToken = await getClientToken();

  // RC5/RC6 (r12): the timestamp comes from the tracked server offset rather than the raw local
  // clock, so a browser whose clock is outside the server's 15-minute window still signs inside
  // it once any response has taught lib/serverTime.ts the offset. Both the timestamp AND the
  // signature are re-derived on every attempt, which is what makes the retry below meaningful —
  // replaying the same timestamp with a fresh key would fail again for the same reason.
  const performFetch = async (): Promise<Response> => {
    const timestamp = getServerTimestamp();
    const signature = await generateRequestSignatureAsync(method, endpoint, payload, timestamp);

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
      'x-client-token': clientToken,
      'x-request-signature': signature,
      'x-request-timestamp': timestamp.toString()
    };

    return fetch(endpoint, {
      ...options,
      method,
      headers,
      body: JSON.stringify(payload)
    });
  };

  let response = await performFetch();

  if (response.status === 403) {
    const data = await response
      .clone()
      .json()
      .catch(() => null);
    const code = (data as any)?.code as string | undefined;

    if (code === 'INVALID_CLIENT_TOKEN') {
      // L1. Orthogonal to the signature, and the shared L2 helper has no equivalent, so it stays
      // here.
      console.warn('[secureFetch] Invalid client token detected, refreshing and retrying', { endpoint, method });
      clientToken = await refreshClientToken();
      response = await performFetch();
    } else if (recoverFromSignatureRejection(response.status, data)) {
      // L2. recoverFromSignatureRejection() is the shared helper: it applies the serverTime the
      // 403 body now carries AND drops the cached per-session signing key. The bespoke branch
      // this replaced only did the latter, so a clock-skewed client re-signed with the same wrong
      // clock and got the same 403 — the RC5 loop the reported wallet was stuck in.
      console.warn('[secureFetch] Request signature rejected, correcting clock, refreshing signing key and retrying', { endpoint, method });
      response = await performFetch();
    }
  }

  // Only ever one recovery attempt; the final response is returned even if it is still a 403.
  return response;
};
