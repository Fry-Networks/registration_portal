import useSWR from 'swr';
import { getClientToken } from '../clientToken';
import { generateRequestSignatureAsync } from '../requestSignature.client';
import { useFingerprintReady } from '../../app/fingerprintcontext';

export type Summary = { pending: number; claimable: number; claimed?: number; accruing?: number; nextUnlockAt?: string };

const fetcher = async (key: string): Promise<Summary> => {
  const [, miner_key] = key.split(':');
  
  const clientToken = await getClientToken();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await generateRequestSignatureAsync('POST', '/api/rewards/get-reward-summary', { miner_key }, timestamp);
  
  const res = await fetch('api/rewards/get-reward-summary', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-token': clientToken,
      'x-request-signature': signature,
      'x-request-timestamp': timestamp.toString()
    },
    body: JSON.stringify({ miner_key })
  });
  if (!res.ok) throw new Error('Failed to fetch summary');
  const json = await res.json();
  return json?.summary ?? { pending: 0, claimable: 0 };
};

export function useRewardSummary(miner_key?: string) {
  const { ready } = useFingerprintReady();
  const key = miner_key && ready ? `reward-summary:${miner_key}` : null;
  const swr = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000
  });
  return swr;
}
