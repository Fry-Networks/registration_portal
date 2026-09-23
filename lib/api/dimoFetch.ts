/**
 * DIMO page network helper (CLIENT-SIDE ONLY).
 *
 * R12b: pages/dimo.tsx built the L1/L2 headers inline. That copy called getClientToken() once and
 * sent whatever came back, so a tab holding a token the server rejects -- the value the pre-R12
 * bundle derived from the retired shared constant, or a token minted for a session that has since
 * rotated -- stayed broken for the whole 10-minute lib/clientToken.ts cache window with no way
 * back. lib/api/secureFetch.ts already performs exactly one refreshClientToken() + retry on
 * 403 INVALID_CLIENT_TOKEN, so the non-claim DIMO calls now delegate to it instead of carrying a
 * second, un-healing copy of the same header logic.
 *
 * Retrying that particular rejection is safe: verifyClientToken() answers 403 BEFORE the route
 * handler runs (lib/clientTokenMiddleware.ts), so the rejected attempt provably mutated nothing.
 *
 * /api/dimo/claim is nonetheless EXCLUDED. It is a claim submit, and this round deliberately
 * leaves claim submit and confirm on a single attempt.
 */
import { secureFetch } from './secureFetch';
import { getClientToken } from '../clientToken';
import { generateRequestSignatureAsync } from '../requestSignature.client';
import { getServerTimestamp } from '../serverTime';

export const CLAIM_SUBMIT_ENDPOINTS: ReadonlySet<string> = new Set<string>(['/api/dimo/claim']);

export const dimoFetch = async (
  endpoint: string,
  method: 'GET' | 'POST',
  payload: any = {}
): Promise<Response> => {
  if (!CLAIM_SUBMIT_ENDPOINTS.has(endpoint)) {
    // Inherits the single-shot L1 refresh-and-retry (and the L2 clock/key recovery).
    return secureFetch(endpoint, payload, { method });
  }

  // Claim submit: exactly one attempt, no refresh-and-retry.
  const token = await getClientToken();
  const timestamp = getServerTimestamp();
  const signature = await generateRequestSignatureAsync(method, endpoint, payload, timestamp);
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'x-client-token': token,
    'x-request-signature': signature,
    'x-request-timestamp': timestamp.toString()
  };
  return fetch(endpoint, {
    method,
    headers,
    // Send the payload even on GET so the signature body matches what the server verifies.
    body: JSON.stringify(payload)
  });
};
