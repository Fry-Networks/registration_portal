import fs from 'fs';
import path from 'path';
import { MongoClient, Db } from 'mongodb';
import algosdk from 'algosdk';
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

let merkleCache: MerkleData | null = null;

function getMerkle(): MerkleData {
  if (!merkleCache) {
    const p = path.join(process.cwd(), 'data', 'preseed_merkle.json');
    merkleCache = JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  return merkleCache!;
}

// V1 FryMinerRewardPool (live). FRY3 flip: change to 3622586363 (V2) + rebuild.
const APP_ID = 3592975326;
const ALGOD_URL = process.env.ALGOD_URL || 'https://mainnet-api.algonode.cloud';
const MONGO_URI = process.env.MONGO_URI || '';

async function getMongoDb(): Promise<Db> {
  const client = new MongoClient(MONGO_URI, {
    tls: true,
    tlsCAFile: '/etc/ssl/mongo/mongo-ca.crt',
  });
  await client.connect();
  return client.db('main');
}

async function checkAlreadyClaimed(wallet: string): Promise<boolean> {
  try {
    const algod = new algosdk.Algodv2('', ALGOD_URL, '');
    const decoded = algosdk.decodeAddress(wallet);
    const boxName = new Uint8Array([0x77, ...decoded.publicKey]);
    await algod.getApplicationBoxByName(APP_ID, boxName).do();
    return true; // Box exists = already claimed
  } catch (err: any) {
    if (err?.status === 404) return false; // Box doesn't exist
    console.error('Box check error:', err);
    return false; // Assume not claimed on error
  }
}

async function checkUptimeGate(wallet: string): Promise<boolean> {
  try {
    const db = await getMongoDb();
    
    // Find devices where reward_wallet === wallet
    const devices = await db.collection('devices').find({ reward_wallet: wallet }).toArray();
    if (devices.length === 0) return false;
    
    const minerKeys = devices.map((d: any) => d.miner_key);
    
    // Check if ANY device has reward_eligible: true in PoC.hardware
    const hwDocs = await db.collection('hardware')
      .find({ 
        miner_key: { $in: minerKeys },
        reward_eligible: true 
      })
      .limit(1)
      .toArray();
    
    return hwDocs.length > 0;
  } catch (err) {
    console.error('Uptime gate check error:', err);
    return false;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { wallet } = req.query;
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ error: 'wallet param required' });
  }

  // Check 1: In preseed tree?
  const entry = getMerkle().wallets?.[wallet];
  if (!entry) {
    return res.status(200).json({ eligible: false, reason: 'not_in_preseed' });
  }

  // Check 2: Already claimed?
  const alreadyClaimed = await checkAlreadyClaimed(wallet);
  if (alreadyClaimed) {
    return res.status(200).json({ eligible: false, reason: 'already_claimed', entitled_tfry: entry.entitled_tfry, entitled_fnode: entry.entitled_fnode });
  }

  // Check 3: Uptime gate (mandatory)
  const hasEligibleDevice = await checkUptimeGate(wallet);
  if (!hasEligibleDevice) {
    return res.status(200).json({ eligible: false, reason: 'no_eligible_device' });
  }

  return res.status(200).json({
    eligible: true,
    entitled_tfry: entry.entitled_tfry,
    entitled_fnode: entry.entitled_fnode,
  });
}
