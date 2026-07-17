import type { NextApiRequest, NextApiResponse } from 'next';
import algosdk from 'algosdk';

const APP_ID = 3636406117;
const ALGOD_URL = process.env.ALGOD_URL || 'http://100.69.195.100:8190';
const ALGOD_TOKEN = process.env.ALGOD_TOKEN || '';

interface HoldingsResponse {
  wallet: string;
  count: number;
  token_ids: number[];
  note?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<Partial<HoldingsResponse> | { error: string }>
) {
  const { wallet } = req.query;

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ error: 'Invalid wallet address' });
  }

  try {
    // Validate address
    if (!algosdk.isValidAddress(wallet)) { return res.status(400).json({ error: 'Invalid Algorand address' }); }

    const algod = new algosdk.Algodv2(ALGOD_TOKEN, ALGOD_URL);

    // List app boxes
    const boxesRes = await algod.getApplicationBoxes(APP_ID).do();
    const boxes = boxesRes.boxes || [];

    // Filter boxes with 'o' prefix (owner boxes)
    const ownerBoxes = boxes.filter((box: any) => {
      const name = box.name;
      let buf: Uint8Array;
      if (typeof name === 'string') {
        buf = new Uint8Array(Buffer.from(name, 'base64'));
      } else if (name instanceof Uint8Array || Buffer.isBuffer(name)) {
        buf = new Uint8Array(name);
      } else {
        return false;
      }
      return buf.length > 0 && buf[0] === 0x6f; // 'o' in ASCII
    });

    const tokenIds: number[] = [];
    const walletDecoded = algosdk.decodeAddress(wallet);
    const walletPubKey = walletDecoded.publicKey;

    // Read each owner box
    for (const box of ownerBoxes) {
      try {
        const boxValue = await algod
          .getApplicationBoxByName(APP_ID, box.name as any)
          .do();

        // Check if the owner pubkey matches the wallet
        const ownerPubKeyBuf = typeof boxValue.value === 'string'
          ? Buffer.from(boxValue.value, 'base64')
          : Buffer.from(boxValue.value);
        if (ownerPubKeyBuf.length === 32 && ownerPubKeyBuf.every((v: number, i: number) => v === walletPubKey[i])) {
          // Extract token_id from box name: 'o' + uint64_be8(token_id)
          const boxNameBuf = typeof box.name === 'string'
            ? Buffer.from(box.name, 'base64')
            : Buffer.from(box.name);
          if (boxNameBuf.length === 9) {
            const tokenIdBuf = boxNameBuf.slice(1, 9);
            const view = new DataView(tokenIdBuf.buffer, tokenIdBuf.byteOffset, 8);
            const tokenId = Number(view.getBigUint64(0, false)); // big-endian
            tokenIds.push(tokenId);
          }
        }
      } catch (err: any) {
        // Skip boxes that can't be read
        continue;
      }
    }

    // Sort token IDs
    tokenIds.sort((a, b) => a - b);

    return res.status(200).json({
      wallet,
      count: tokenIds.length,
      token_ids: tokenIds,
    });
  } catch (err: any) {
    if (err?.message?.includes('invalid address')) {
      return res.status(400).json({ error: 'Invalid Algorand address' });
    }
    console.error('Genesis holdings fetch error:', err);
    return res.status(200).json({
      wallet: typeof wallet === 'string' ? wallet : '',
      count: 0,
      token_ids: [],
      note: 'Could not fetch holdings',
    });
  }
}
