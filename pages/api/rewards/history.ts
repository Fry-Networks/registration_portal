import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // DEFERRED: chain-only claim history v1
  // Querying on-chain box state for historical claims requires box iteration
  // which is not yet implemented. Returning empty for now.
  return res.status(200).json({
    claims: [],
    deferred: true,
    note: "Claim history query deferred — no Mongo data path for epoch-aware claims yet"
  });
}
