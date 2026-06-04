import { useMemo } from "react";
import useSWR from "swr";

export type TokenBalanceEntry = {
  key: string;
  address: string;
  asset_id: string;
};

const fetcher = async (key: string): Promise<Record<string, { opted_in: boolean }>> => {
  const entries: TokenBalanceEntry[] = JSON.parse(
    key.replace("token-balance-batch:", "")
  );

  const res = await fetch("/api/algorand/get-token-balances", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ entries }),
  });

  if (!res.ok) throw new Error("Failed to fetch batch token balances");
  const json = await res.json();
  return json?.results ?? {};
};

export function useTokenBalanceBatch(entries: TokenBalanceEntry[]) {
  const key = useMemo(() => {
    if (!entries.length) return null;
    const sorted = [...entries].sort((a, b) => a.key.localeCompare(b.key));
    return `token-balance-batch:${JSON.stringify(sorted)}`;
  }, [entries]);

  return useSWR<Record<string, { opted_in: boolean }>>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  });
}
