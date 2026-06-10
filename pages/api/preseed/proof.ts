import fs from 'fs';
import path from 'path';
import type { NextApiRequest, NextApiResponse } from 'next';

interface WalletEntry {
  leaf_index: number;
  proof: string;
  entitled_tfry: number;
  entitled_fnode: number;
}

interface MerkleData {
  root: string;
  wallets: Record<string, WalletEntry>;
}

let cache: MerkleData | null = null;

function getMerkle(): MerkleData {
  if (!cache) {
    const p = path.join(process.cwd(), 'data', 'preseed_merkle.json');
    cache = JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return cache!;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const { wallet } = req.query;
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ error: 'wallet param required' });
  }
  const entry = getMerkle().wallets?.[wallet];
  if (!entry) {
    return res.status(200).json({ eligible: false });
  }
  return res.status(200).json({
    eligible: true,
    leaf_index: entry.leaf_index,
    proof: entry.proof,
    entitled_tfry: entry.entitled_tfry,
    entitled_fnode: entry.entitled_fnode,
  });
}
