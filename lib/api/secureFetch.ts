import { getClientToken } from '../clientToken';
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
  const clientToken = await getClientToken();
  const timestamp = Math.floor(Date.now() / 1000);
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
