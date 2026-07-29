import { useMemo } from 'react';
import useSWR from 'swr';
import { getClientToken, refreshClientToken } from '../clientToken';
import { generateRequestSignatureAsync } from '../requestSignature.client';
import { useFingerprintReady } from '../../app/fingerprintcontext';
import { fetchWithFingerprintRetry } from '../api/fetchWithFingerprintRetry';
import type { Summary } from './useRewardSummary';

const createBatchFetcher = (refreshFingerprint: () => Promise<boolean>) => async (key: string): Promise<Record<string, Summary>> => {
  const minerKeys = key.replace('reward-summary-batch:', '').split(',').filter(Boolean);

  const refreshClientTokenOnce = async () => {
    try {
      await refreshClientToken();
      return true;
    } catch (error) {
      console.error('[ClientToken] Failed to refresh token for batch summary fetch', error);
      return false;
    }
  };

  const makeRequest = async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = { miner_keys: minerKeys };
    const signature = await generateRequestSignatureAsync('POST', '/api/rewards/get-reward-summary-batch', payload, timestamp);
    const clientToken = await getClientToken();

    return fetch('/api/rewards/get-reward-summary-batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-client-token': clientToken,
        'x-request-signature': signature,
        'x-request-timestamp': timestamp.toString()
      },
      body: JSON.stringify(payload)
    });
  };

  const res = await fetchWithFingerprintRetry(makeRequest, refreshFingerprint, {
    refreshClientToken: refreshClientTokenOnce
  });
  if (!res.ok) {
    // Carry the status/code so callers can tell a recoverable failure (fingerprint refresh,
    // limiter, network reset) from one that warrants the per-device fallback.
    let code: string | undefined;
    try {
      const payload = await res.clone().json();
      code = typeof payload?.code === 'string' ? payload.code : undefined;
    } catch {
      code = undefined;
    }
    const error = Object.assign(new Error('Failed to fetch batch summary'), {
      status: res.status,
      code
    });
    throw error;
  }
  const json = await res.json();
  return json?.summaries ?? {};
};

export function useRewardSummaryBatch(minerKeys: string[]) {
  const { ready, refresh } = useFingerprintReady();
  const fetcher = useMemo(() => createBatchFetcher(refresh), [refresh]);
  const stableKey = useMemo(() => {
    if (!minerKeys.length) return null;
    return `reward-summary-batch:${[...minerKeys].sort().join(',')}`;
  }, [minerKeys]);
  const key = stableKey && ready ? stableKey : null;
  const swr = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000
  });
  return swr;
}
