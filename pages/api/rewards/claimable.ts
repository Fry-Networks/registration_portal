import type { NextApiRequest, NextApiResponse } from 'next';
import algosdk from 'algosdk';

const APP_ID = 3592975326;
const ALGOD_URL = process.env.ALGOD_URL || 'http://100.69.195.100:4190';

interface ClaimableResponse {
  boxFound: boolean;
  entitled_tfry?: number;
  entitled_fnode?: number;
  matured_tfry?: number;
  matured_fnode?: number;
  claimed_tfry?: number;
  claimed_fnode?: number;
  claimable_tfry?: number;
  claimable_fnode?: number;
  recent_tfry?: number;
  recent_fnode?: number;
  epoch?: number;
}

function decodeBoxValue(value: Uint8Array | string): { entitled_tfry: number; entitled_fnode: number; matured_tfry: number; matured_fnode: number; claimed_tfry: number; claimed_fnode: number; epoch: number } {
  const buf = typeof value === 'string' ? Buffer.from(value, 'base64') : Buffer.from(value);
  if (buf.length < 56) throw new Error('Box value too short');
  return {
    entitled_tfry: Number(buf.readBigUInt64BE(0)),
    entitled_fnode: Number(buf.readBigUInt64BE(8)),
    matured_tfry: Number(buf.readBigUInt64BE(16)),
    matured_fnode: Number(buf.readBigUInt64BE(24)),
    claimed_tfry: Number(buf.readBigUInt64BE(32)),
    claimed_fnode: Number(buf.readBigUInt64BE(40)),
    epoch: Number(buf.readBigUInt64BE(48)),
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<ClaimableResponse>) {
  const { wallet } = req.query;
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ boxFound: false });
  }

  try {
    const algod = new algosdk.Algodv2('', ALGOD_URL, '');
    const decoded = algosdk.decodeAddress(wallet);
    const boxName = new Uint8Array([0x77, ...decoded.publicKey]);
    const boxRes = await algod.getApplicationBoxByName(APP_ID, boxName).do();
    const state = decodeBoxValue(boxRes.value);

    const claimable_tfry = state.entitled_tfry - state.claimed_tfry;
    const claimable_fnode = state.entitled_fnode - state.claimed_fnode;
    const fee_free_tfry = Math.max(0, state.matured_tfry - state.claimed_tfry);
    const fee_free_fnode = Math.max(0, state.matured_fnode - state.claimed_fnode);
    const recent_tfry = Math.max(0, claimable_tfry - fee_free_tfry);
    const recent_fnode = Math.max(0, claimable_fnode - fee_free_fnode);

    return res.status(200).json({
      boxFound: true,
      entitled_tfry: state.entitled_tfry,
      entitled_fnode: state.entitled_fnode,
      matured_tfry: fee_free_tfry,
      matured_fnode: fee_free_fnode,
      claimed_tfry: state.claimed_tfry,
      claimed_fnode: state.claimed_fnode,
      claimable_tfry,
      claimable_fnode,
      recent_tfry,
      recent_fnode,
      epoch: state.epoch,
    });
  } catch (err: any) {
    if (err?.status === 404 || err?.message?.includes('box not found')) {
      return res.status(200).json({ boxFound: false });
    }
    console.error('claimable fetch error:', err);
    return res.status(502).json({ boxFound: false });
  }
}
