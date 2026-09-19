import type { NextApiRequest, NextApiResponse } from 'next';
import algosdk from 'algosdk';
import clientPromise from '../../../../lib/mongoclient';
import { getFailoverAlgodClient } from '../../../../lib/algorand/failover';

const APP_ID = Number(process.env.FFG_APP_ID || 3636406117);
const GENESIS_PASS_APP_ID = Number(process.env.GENESIS_PASS_APP_ID || 3509410324);

// Both contracts expose the same global-state key names, so one decoder serves both.
const COLLECTIONS = [
  { key: 'genesis_pass', name: 'fry.farm Genesis Pass', app_id: GENESIS_PASS_APP_ID, fallback_supply: 1000 },
  { key: 'fry_fee_genesis', name: 'Fry Fee Genesis', app_id: APP_ID, fallback_supply: 2000 },
];

type CollectionState = {
  key: string;
  name: string;
  app_id: number;
  total_supply: number;
  total_minted: number | null;
  paused: boolean;
  mint_price_micro: number | null;
  mint_asset_id: number | null;
  degraded: boolean;
};
const ALGOD_URL = process.env.ALGOD_URL || 'http://100.69.195.100:8190';
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || '';

// Decode algod global-state entries across algosdk v2 (b64 string keys,
// number uints) and v3 (Uint8Array keys, bigint uints).
function decodeGlobalState(appInfo: any): Record<string, number> {
  const params: any = appInfo?.params || {};
  const entries: any[] = params['global-state'] || params.globalState || [];
  const out: Record<string, number> = {};
  for (const item of entries) {
    const rawKey: any = item.key;
    const keyStr =
      typeof rawKey === 'string'
        ? Buffer.from(rawKey, 'base64').toString()
        : Buffer.from(rawKey).toString();
    const v: any = item.value || {};
    if (v.uint !== undefined) out[keyStr] = Number(v.uint);
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The banner renders on every page; without this each navigation re-reads the chain.
  res.setHeader('Cache-Control', 'public, max-age=60');

  try {
    // The mint counter is on-chain global state; reading it through the single configured
    // node meant a node outage silently rendered "0 minted" via the degraded fallback.
    const algod = await getFailoverAlgodClient();
    const client = await clientPromise;
    const db = client.db('main');

    // Active reward token — same resolution logic as /api/reward-mode
    const rewardModeDoc = await db.collection('configs').findOne({ _id: 'reward_mode' } as any);
    const mode = rewardModeDoc?.mode || 'FRY2';
    const fry3AsaId = rewardModeDoc?.fry3_asa_id || '3612979527';
    const activeFryAsaId = mode === 'FRY3' ? fry3AsaId : '2485314946';
    const activeFryName = mode === 'FRY3' ? 'FRY' : 'FRY 2.0';

    // FFG config: fee share + accumulated ledger live in Mongo, not on-chain
    const ffgConfigDoc = await db.collection('fry_fee_genesis').findOne({ _id: 'config' } as any);
    const accumulated: Record<string, number> = ffgConfigDoc?.accumulated || {};
    const accumulatedTotal = Object.values(accumulated).reduce((s, v) => s + Number(v || 0), 0);
    const feeShareBps = ffgConfigDoc?.fee_share_bps ?? 1000;

    // On-chain collection state. Read every collection in parallel and keep the failures
    // isolated: one unreachable app must not blank out the other, and a failed read reports
    // total_minted: null rather than 0 (0 is a real, very different, number here).
    const settled = await Promise.allSettled(
      COLLECTIONS.map((c) => algod.getApplicationByID(c.app_id).do())
    );
    const collections: CollectionState[] = COLLECTIONS.map((c, i) => {
      const result = settled[i];
      if (result.status !== 'fulfilled') {
        console.error(`Genesis collection ${c.key} (${c.app_id}) unavailable:`, result.reason);
        return {
          key: c.key,
          name: c.name,
          app_id: c.app_id,
          total_supply: c.fallback_supply,
          total_minted: null,
          paused: true,
          mint_price_micro: null,
          mint_asset_id: null,
          degraded: true,
        };
      }
      const state = decodeGlobalState(result.value);
      return {
        key: c.key,
        name: c.name,
        app_id: c.app_id,
        total_supply: state.max_supply ?? c.fallback_supply,
        total_minted: state.total_minted ?? 0,
        paused: (state.paused ?? 1) === 1,
        mint_price_micro: state.mint_price ?? 175000000,
        mint_asset_id: state.mint_asset_id ?? 31566704,
        degraded: false,
      };
    });

    const ffg = collections.find((c) => c.app_id === APP_ID);
    if (!ffg || ffg.degraded) {
      throw new Error(`Fry Fee Genesis app ${APP_ID} state unavailable`);
    }
    const gs = {
      max_supply: ffg.total_supply,
      total_minted: ffg.total_minted ?? 0,
      paused: ffg.paused ? 1 : 0,
      mint_price: ffg.mint_price_micro ?? 175000000,
      mint_asset_id: ffg.mint_asset_id ?? 31566704,
    } as Record<string, number>;

    return res.status(200).json({
      app_id: APP_ID,
      app_address: algosdk.getApplicationAddress(APP_ID).toString(),
      total_supply: gs.max_supply ?? 2000,
      total_minted: gs.total_minted ?? 0,
      paused: (gs.paused ?? 1) === 1,
      mint_price_micro: gs.mint_price ?? 175000000,
      mint_asset_id: gs.mint_asset_id ?? 31566704,
      fee_share_bps: feeShareBps,
      accumulated,
      accumulated_total: accumulatedTotal,
      active_token: { mode, asa_id: activeFryAsaId, name: activeFryName },
      // Per-collection truth. The fields above describe Fry Fee Genesis only, for the
      // existing consumers; anything showing both collections must read this array.
      collections,
    });
  } catch (err: any) {
    console.error('Genesis config fetch error:', err);
    // Fail safe: report paused so the UI never offers minting on bad data
    return res.status(200).json({
      app_id: APP_ID,
      app_address: algosdk.getApplicationAddress(APP_ID).toString(),
      total_supply: 2000,
      total_minted: 0,
      paused: true,
      mint_price_micro: 175000000,
      mint_asset_id: 31566704,
      fee_share_bps: 1000,
      accumulated: {},
      accumulated_total: 0,
      active_token: { mode: 'FRY2', asa_id: '2485314946', name: 'FRY 2.0' },
      collections: COLLECTIONS.map((c) => ({
        key: c.key,
        name: c.name,
        app_id: c.app_id,
        total_supply: c.fallback_supply,
        total_minted: null,
        paused: true,
        mint_price_micro: null,
        mint_asset_id: null,
        degraded: true,
      })),
      note: 'degraded: on-chain state unavailable',
    });
  }
}
