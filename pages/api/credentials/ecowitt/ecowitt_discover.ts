// Using native fetch available in Node.js 18+

export type DeviceSummary = { mac: string; name: string };

const DEFAULT_MAX_AGE_SECONDS = 3600;

function extractMostRecentTsFromInner(inner: any): number {
  if (!inner || typeof inner !== 'object') return 0;
  const lastUpdate = inner.last_update || inner.lastUpdate || {};
  let maxTs = 0;
  function walk(obj: any) {
    if (!obj) return;
    if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    } else if (typeof obj === 'object') {
      for (const [k, v] of Object.entries(obj)) {
        if (k === 'time') {
          const n = parseInt(String(v), 10);
          if (!Number.isNaN(n) && n > maxTs) maxTs = n;
        } else {
          walk(v);
        }
      }
    }
  }
  walk(lastUpdate);
  return maxTs;
}

function normalizeKey(k: string): string {
  return String(k || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

function extractSensorKeysFromCloudData(inner: any): Set<string> {
  const keys = new Set<string>();
  function walk(prefix: string[], obj: any) {
    if (!obj) return;
    if (typeof obj === 'object' && !Array.isArray(obj)) {
      if ('value' in obj && ('time' in obj || 'unit' in obj)) {
        const leaf = prefix.length ? prefix[prefix.length - 1] : '';
        if (leaf) {
          keys.add(normalizeKey(leaf));
          if (prefix.length >= 2) keys.add(normalizeKey(`${prefix[prefix.length - 2]}_${leaf}`));
        }
        return;
      }
      for (const [k, v] of Object.entries(obj)) {
        walk([...prefix, k], v);
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) walk(prefix, item);
    }
  }
  const lastUpdate = inner.last_update || inner.lastUpdate || {};
  walk([], lastUpdate);
  return keys;
}

function detectMinerTypeWithScores(keys: Set<string>) {
  // indicator keys (normalized)
  const indicators: Record<string, string[]> = {
    air: ['pm25', 'pm10', 'pm2_5', 'pm2_5_ch1', 'pm25_ch1', 'pm25_ch2', 'aqi', 'co2', 'tvoc', 'pm', 'pm25_ch'],
    weather: ['temperature', 'temp', 'humidity', 'wind_speed', 'wind_mph', 'wind_kph', 'pressure', 'rainin', 'rain_rate'],
    energy: ['voltage', 'current', 'power', 'energy', 'watt', 'watt_hour', 'power_w'],
    water: ['water_level', 'water_temp', 'leak', 'water_flow', 'flow', 'rainin'],
    soil: ['soil_moisture', 'soil_temp', 'ec', 'moisture'],
  };

  const scores: Record<string, number> = Object.fromEntries(Object.keys(indicators).map(k => [k, 0]));

  for (const key of Array.from(keys)) {
    for (const t of Object.keys(indicators)) {
      for (const ind of indicators[t]) {
        if (key === ind || key.includes(ind)) scores[t] += 1;
      }
    }
  }

  // If any collected key contains 'power', treat this as a strong energy indicator
  if (Array.from(keys).some(k => k.includes('power'))) {
    // boost energy to ensure it is selected over mixed/weather payloads
    const maxScore = Math.max(...Object.values(scores), 0);
    scores['energy'] = maxScore + 100;
  }

  // pick best (ties resolved by highest score; if 0 return null)
  let best: string | null = null;
  let bestScore = 0;
  for (const [t, s] of Object.entries(scores)) {
    if (s > bestScore) {
      best = t;
      bestScore = s;
    }
  }

  return { scores, best };
}

async function getEcowittCloudData(appKey: string, apiKey: string, mac: string): Promise<any | null> {
  if (!appKey || !apiKey || !mac) return null;
  const url = `https://api.ecowitt.net/api/v3/device/info?application_key=${appKey}&api_key=${apiKey}&mac=${mac}`;
  try {
    console.debug('GET', url);
    const res = await fetch(url, { method: 'GET', timeout: 15000 } as any);
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.code === 0 && typeof data.data === 'object') return data.data;
  } catch (err) {
    console.debug('getEcowittCloudData failed:', String((err as any)?.message || err));
  }
  return null;
}

export async function listActiveDevicesByType(appKey: string, apiKey: string, minerType: string, maxAgeSeconds = DEFAULT_MAX_AGE_SECONDS): Promise<DeviceSummary[]> {
  const out: DeviceSummary[] = [];
  let page = 1;
  const now = Math.floor(Date.now() / 1000);
  const seenMacs = new Set<string>();

  try {
    while (true) {
      const listUrl = `https://api.ecowitt.net/api/v3/device/list?application_key=${appKey}&api_key=${apiKey}&page=${page}`;
      console.debug('GET', listUrl);
      const res = await fetch(listUrl, { method: 'GET', timeout: 15000 } as any);
      if (!res.ok) break;
      const top = await res.json();
      if (!top || top.code !== 0 || typeof top.data !== 'object') break;
      const payload = top.data;

      // Extract page entries (support both shapes)
      let pageEntries: any[] = [];
      if (Array.isArray(payload)) pageEntries = payload;
      else if (payload && Array.isArray(payload.list)) pageEntries = payload.list;
      else break;

      if (!pageEntries || pageEntries.length === 0) break;

      for (const entry of pageEntries) {
        const mac = entry.mac || entry.device || entry.deviceId || entry.device_id;
        const name = entry.name || entry.stationtype || entry.station_name || '';
        if (!mac) continue;
        if (seenMacs.has(mac)) continue;
        seenMacs.add(mac);

        const inner = await getEcowittCloudData(appKey, apiKey, mac);
        if (!inner) continue;
        const lastTs = extractMostRecentTsFromInner(inner);
        if (!lastTs) continue;
        const age = now - lastTs;
        if (age > maxAgeSeconds) continue;
        const sensorKeys = extractSensorKeysFromCloudData(inner);
        const detected = detectMinerTypeWithScores(sensorKeys).best;
        if (detected && detected === minerType) out.push({ mac, name });
      }

      // If totalPage present, stop when we've reached it
      if (typeof payload === 'object' && payload && Number.isInteger(payload.totalPage)) {
        const totalPages = Number(payload.totalPage || 0);
        if (page >= totalPages) break;
      }

      page += 1;
    }
  } catch (err) {
    console.debug('listActiveDevicesByType failed:', String((err as any)?.message || err));
  }

  return out;
}

import { NextApiRequest, NextApiResponse } from 'next';

// API endpoint for discovering Ecowitt devices
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { appKey, apiKey, minerType, maxAgeSeconds } = req.body;

  if (!appKey || !apiKey || !minerType) {
    return res.status(400).json({ 
      error: 'Missing required parameters: appKey, apiKey, minerType' 
    });
  }

  try {
    const devices = await listActiveDevicesByType(
      appKey, 
      apiKey, 
      minerType, 
      maxAgeSeconds || DEFAULT_MAX_AGE_SECONDS
    );
    
    res.status(200).json({ 
      success: true, 
      devices,
      count: devices.length 
    });
  } catch (error) {
    console.error('Ecowitt device discovery failed:', error);
    res.status(500).json({ 
      error: 'Failed to discover devices',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

// Simple CLI if run directly
if (require.main === module) {
  (async function () {
    const args = process.argv.slice(2);
    const argv: Record<string, string> = {};
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a.startsWith('--')) {
        const k = a.slice(2);
        argv[k] = args[i + 1];
        i++;
      }
    }
    const app = argv.app;
    const api = argv.api;
    const type = argv.type;
    if (!app || !api || !type) {
      console.error('Usage: node ecowitt_discover.js --app APP --api API --type <air|weather|energy|water|soil>');
      process.exit(2);
    }
    const res = await listActiveDevicesByType(app, api, type);
    console.log(JSON.stringify(res, null, 2));
  })();
}
