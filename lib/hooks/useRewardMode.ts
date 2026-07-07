import { useEffect, useState } from 'react';

interface RewardModeConfig {
  mode: string;
  activeFryAsaId: string;
  activeFryName: string;
  loading: boolean;
}

let cachedConfig: RewardModeConfig | null = null;
let fetchPromise: Promise<RewardModeConfig> | null = null;

async function fetchRewardMode(): Promise<RewardModeConfig> {
  try {
    const res = await fetch('/api/reward-mode');
    if (!res.ok) throw new Error('fetch failed');
    const data = await res.json();
    return { mode: data.mode || 'FRY2', activeFryAsaId: data.active_fry_asa_id || '2485314946', activeFryName: data.active_fry_name || 'FRY 2.0', loading: false };
  } catch {
    return { mode: 'FRY2', activeFryAsaId: '2485314946', activeFryName: 'FRY 2.0', loading: false };
  }
}

export function useRewardMode(): RewardModeConfig {
  const [config, setConfig] = useState<RewardModeConfig>(cachedConfig || { mode: 'FRY2', activeFryAsaId: '2485314946', activeFryName: 'FRY 2.0', loading: true });
  useEffect(() => {
    if (cachedConfig) { setConfig(cachedConfig); return; }
    if (!fetchPromise) { fetchPromise = fetchRewardMode(); }
    fetchPromise.then((r) => { cachedConfig = r; setConfig(r); });
  }, []);
  return config;
}
