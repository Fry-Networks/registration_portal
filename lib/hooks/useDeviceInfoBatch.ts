import { useMemo } from "react";
import useSWR from "swr";
import type { Device } from "../types";

const fetcher = async (key: string): Promise<Record<string, Device>> => {
  const minerKeys = key.replace("device-info-batch:", "").split(",").filter(Boolean);

  const res = await fetch("/api/devices/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ miner_keys: minerKeys }),
  });

  if (!res.ok) throw new Error("Failed to fetch batch device info");
  const json = await res.json();
  return json?.devices ?? {};
};

export function useDeviceInfoBatch(minerKeys: string[]) {
  const key = useMemo(() => {
    if (!minerKeys.length) return null;
    return `device-info-batch:${[...minerKeys].sort().join(",")}`;
  }, [minerKeys]);

  return useSWR<Record<string, Device>>(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });
}
