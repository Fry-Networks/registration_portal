import type { NextApiRequest, NextApiResponse } from 'next';
import algosdk from 'algosdk';
import clientPromise from '../../../../lib/mongoclient';

const APP_ID = Number(process.env.FFG_APP_ID || 3636406117);
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

  try {
    const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_URL);
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

    // On-chain collection state
    const appInfo = await algod.getApplicationByID(APP_ID).do();
    const gs = decodeGlobalState(appInfo);

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
      note: 'degraded: on-chain state unavailable',
    });
  }
}
