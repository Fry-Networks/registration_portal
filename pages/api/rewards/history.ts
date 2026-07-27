import type { NextApiRequest, NextApiResponse } from "next";
import algosdk from "algosdk";
import clientPromise from "../../../lib/mongoclient";

// Real claim history from main.reward_pending_claims (completion run 1785182603).
// Replaces the shipped stub that returned 200 {"claims":[],"deferred":true} for every
// caller — an honest wallet-scoped query now that the claim collection exists.
// Voided envelopes (groupId renamed by audit_1785138747) are excluded: only rows still
// carrying groupId are user-visible claim history. signedServerLegsB64 is never projected.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ success: false, message: "Method not allowed" });
  }
  const wallet = typeof req.query.wallet === "string" ? req.query.wallet : "";
  if (!wallet || !algosdk.isValidAddress(wallet)) {
    return res.status(400).json({ success: false, message: "Valid wallet query parameter required" });
  }
  try {
    const client = await clientPromise;
    const claims = await client
      .db("main")
      .collection("reward_pending_claims")
      .find(
        { claimingAddress: wallet, groupId: { $exists: true } },
        {
          projection: {
            _id: 0,
            groupId: 1,
            status: 1,
            totalAmount: 1,
            totalsDisplay: 1,
            createdAt: 1,
            expiresAt: 1,
          },
        }
      )
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();
    return res.status(200).json({ success: true, claims });
  } catch (err) {
    console.error("[rewards/history] query failed:", err instanceof Error ? err.message : err);
    return res.status(500).json({ success: false, message: "Claim history unavailable" });
  }
}
