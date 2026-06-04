import { useMemo } from 'react';
import useSWR from 'swr';
import { getClientToken, refreshClientToken } from '../clientToken';
import { generateRequestSignatureAsync } from '../requestSignature.client';
import { useFingerprintReady } from '../../app/fingerprintcontext';
import { fetchWithFingerprintRetry } from '../api/fetchWithFingerprintRetry';

export type Summary = {
  pending: number;
  claimable: number;
  claimed?: number;
  accruing?: number;
  nextUnlockAt?: string | null;
  firstRewardAt?: string | null;
  legacyFryClaimedSnapshot?: number;
};

const createFetcher = (refreshFingerprint: () => Promise<boolean>) => async (key: string): Promise<Summary> => {
  const [, miner_key] = key.split(':');
  
  const refreshClientTokenOnce = async () => {
    try {
      await refreshClientToken();
      return true;
    } catch (error) {
      console.error('[ClientToken] Failed to refresh token for summary fetch', error);
      return false;
    }
  };

  const makeRequest = async () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const payload = { miner_key };
    const signature = await generateRequestSignatureAsync('POST', '/api/rewards/get-reward-summary', payload, timestamp);
    const clientToken = await getClientToken();

    return fetch('/api/rewards/get-reward-summary', {
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
  if (!res.ok) throw new Error('Failed to fetch summary');
  const json = await res.json();
  return json?.summary ?? { pending: 0, claimable: 0, firstRewardAt: null };
};

export function useRewardSummary(miner_key?: string) {
  const { ready, refresh } = useFingerprintReady();
  const fetcher = useMemo(() => createFetcher(refresh), [refresh]);
  const key = miner_key && ready ? `reward-summary:${miner_key}` : null;
  const swr = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000
  });
  return {
    data: swr.data,
    isLoading: swr.isLoading,
    error: swr.error,
    isError: Boolean(swr.error),
    mutate: swr.mutate
  };
}
