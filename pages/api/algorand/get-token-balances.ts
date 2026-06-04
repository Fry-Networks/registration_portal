import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import { getAssetBalance } from "../../../lib/algorand/balances";

const MAX_BATCH_SIZE = 200;

type BalanceEntry = {
  key: string;
  address: string;
  asset_id: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const { entries } = req.body as { entries?: BalanceEntry[] };

  if (!Array.isArray(entries) || entries.length === 0) {
    return res.status(400).json({ message: "Invalid or missing entries array" });
  }

  if (entries.length > MAX_BATCH_SIZE) {
    return res.status(400).json({ message: `Batch size ${entries.length} exceeds maximum of ${MAX_BATCH_SIZE}` });
  }

  try {
    // Deduplicate by {address, asset_id} pair — 68 devices often share same wallet
    const pairMap = new Map<string, { address: string; asset_id: string; keys: string[] }>();
    for (const entry of entries) {
      if (!entry.address || !entry.asset_id || !entry.key) continue;
      const pairKey = `${entry.address}:${entry.asset_id}`;
      const existing = pairMap.get(pairKey);
      if (existing) {
        existing.keys.push(entry.key);
      } else {
        pairMap.set(pairKey, { address: entry.address, asset_id: entry.asset_id, keys: [entry.key] });
      }
    }

    const results: Record<string, { opted_in: boolean }> = {};

    for (const { address, asset_id, keys } of Array.from(pairMap.values())) {
      const balance = await getAssetBalance(address, asset_id);
      // byte-match per-device handler: balance === null means not opted in
      const opted_in = balance !== null;
      for (const key of keys) {
        results[key] = { opted_in };
      }
    }

    return res.status(200).json({ success: true, results });
  } catch (error) {
    console.error("[get-token-balances] Batch balance check failed", error);
    return res.status(500).json({ message: "Internal server error" });
  }
}
