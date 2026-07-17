import type { NextApiRequest, NextApiResponse } from 'next';
import algosdk from 'algosdk';
import clientPromise from '../../../../../lib/mongoclient';

const APP_ID = Number(process.env.FFG_APP_ID || 3636406117);
const ALGOD_URL = process.env.ALGOD_URL || 'http://100.69.195.100:8190';
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || '';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { wallet } = req.query;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    if (!algosdk.isValidAddress(wallet)) { return res.status(400).json({ error: 'Invalid Algorand address' }); }

    const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_URL);
    const client = await clientPromise;
    const db = client.db('main');

    // FFG ledger (new model): per-slot cumulative accrual per asset. Legacy `accumulated ÷ total_minted`
    // is retired here — the ledger already stores the equal per-pass share (accrual over all 2,000 slots).
    const ledgerDoc = await db.collection('ffg_ledger_state').findOne({ _id: 'state' } as any);
    const ledgerState: Record<string, any> = ledgerDoc?.state || {};
    const cumPerSlot: Record<string, number> = {};
    for (const [asaId, s] of Object.entries(ledgerState)) {
      cumPerSlot[asaId] = Number((s as any)?.cumPerSlot ?? 0);
    }

    // Count this wallet's passes via 'o'-prefix owner boxes
    const walletPubKey = algosdk.decodeAddress(wallet).publicKey;
    const boxesRes = await algod.getApplicationBoxes(APP_ID).do();
    let holdingsCount = 0;
    for (const box of (boxesRes as any).boxes || []) {
      const rawName: any = box.name;
      const buf =
        typeof rawName === 'string'
          ? new Uint8Array(Buffer.from(rawName, 'base64'))
          : new Uint8Array(rawName);
      if (buf.length !== 9 || buf[0] !== 0x6f) continue;
      try {
        const boxValue = await algod.getApplicationBoxByName(APP_ID, buf).do();
        const owner =
          typeof (boxValue as any).value === 'string'
            ? new Uint8Array(Buffer.from((boxValue as any).value, 'base64'))
            : new Uint8Array((boxValue as any).value);
        if (owner.length === 32 && owner.every((v, i) => v === walletPubKey[i])) {
          holdingsCount++;
        }
      } catch {
        continue;
      }
    }

    // This wallet's tracked passes (mint-watcher populated) carry per-pass paid watermarks. Passes held
    // on-chain but not yet in the ledger are treated as paid=0 (fresh, full pending).
    const trackedPasses = await db.collection('ffg_passes').find({ owner: wallet } as any).toArray();
    const untrackedCount = Math.max(0, holdingsCount - trackedPasses.length);

    // Per-pass share by asset from the ledger (all protocol/mint tokens are 6dp).
    // per_pass = cumPerSlot (what one pass has accrued to date); your_estimate = pending across this
    // wallet's passes = Σ max(0, cumPerSlot − paid) over tracked passes + untracked*cumPerSlot.
    const perAsset = Object.entries(cumPerSlot)
      .filter(([, v]) => Number(v) > 0)
      .map(([asaId, cum]) => {
        const perPass = Number(cum);
        let your = 0;
        for (const p of trackedPasses) {
          const paid = Number((p as any)?.paid?.[asaId] ?? 0);
          your += Math.max(0, perPass - paid);
        }
        your += untrackedCount * perPass;
        return {
          asset_id: Number(asaId),
          per_pass: perPass / 1e6,
          your_estimate: your / 1e6,
        };
      });
    const perPassEstimate = perAsset.reduce((s, a) => s + a.per_pass, 0);
    const totalEstimate = perAsset.reduce((s, a) => s + a.your_estimate, 0);

    return res.status(200).json({
      wallet,
      holdings_count: holdingsCount,
      per_pass_estimate: perPassEstimate,
      total_estimate: totalEstimate,
      per_asset: perAsset,
    });
  } catch (err: any) {
    if (err?.message?.includes('invalid address') || err?.message?.includes('checksum')) {
      return res.status(400).json({ error: 'Invalid Algorand address' });
    }
    console.error('Genesis estimate fetch error:', err);
    return res.status(200).json({
      wallet,
      holdings_count: 0,
      per_pass_estimate: 0,
      total_estimate: 0,
      per_asset: [],
      note: 'degraded: estimate unavailable',
    });
  }
}
