import { getClientToken, refreshClientToken } from '../clientToken';
import { generateRequestSignatureAsync } from '../requestSignature.client';

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

  const performFetch = async (token: string): Promise<Response> => {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await generateRequestSignatureAsync(method, endpoint, payload, timestamp);

    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
      'x-client-token': token,
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

  let clientToken = await getClientToken();
  let response = await performFetch(clientToken);

  const tryRecover = async (resp: Response): Promise<Response> => {
    if (resp.status !== 403) return resp;

    const clone = resp.clone();
    try {
      const data = await clone.json().catch(() => null);
      const code = (data as any)?.code as string | undefined;
      if (code === 'INVALID_CLIENT_TOKEN') {
        console.warn('[secureFetch] Invalid client token detected, refreshing and retrying', { endpoint, method });
        clientToken = await refreshClientToken();
        return performFetch(clientToken);
      }
      if (code === 'INVALID_SIGNATURE' || code === 'INVALID_REQUEST_SIGNATURE') {
        console.warn('[secureFetch] Request signature rejected, regenerating and retrying', { endpoint, method });
        return performFetch(clientToken);
      }
    } catch {
      // Ignore parse errors; fall through
    }

    return resp;
  };

  response = await tryRecover(response);

  // Only attempt one recovery; return final response (even if still 403)
  return response;
};
