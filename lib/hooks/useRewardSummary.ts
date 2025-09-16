import useSWR from 'swr';

export type Summary = { pending: number; claimable: number; claimed?: number; accruing?: number; nextUnlockAt?: string };

const fetcher = async (key: string): Promise<Summary> => {
  const [, miner_key] = key.split(':');
  const res = await fetch('api/rewards/get-reward-summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ miner_key })
  });
  if (!res.ok) throw new Error('Failed to fetch summary');
  const json = await res.json();
  return json?.summary ?? { pending: 0, claimable: 0 };
};

export function useRewardSummary(miner_key?: string) {
  const key = miner_key ? `reward-summary:${miner_key}` : null;
  const swr = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000
  });
  return swr;
}
