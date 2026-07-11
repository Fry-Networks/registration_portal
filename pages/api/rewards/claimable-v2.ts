import type { NextApiRequest, NextApiResponse } from 'next';
import algosdk from 'algosdk';
import { V2_APP_ID, V2_APP_ADDR, readV2Box, readV2TokenRegistry } from '../../../lib/rewards/v2Box';

const ALGOD_URL = process.env.ALGOD_URL || 'http://100.69.195.100:8190';

interface V2TokenClaimable {
  index: number;
  asaId: number;
  name: string;
  entitled: number;
  matured: number;
  claimed: number;
  claimable: number;
  underfunded: boolean;
}

interface ClaimableV2Response {
  boxFound: boolean;
  tokens?: V2TokenClaimable[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ClaimableV2Response>
) {
  const { wallet } = req.query;
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ boxFound: false });
  }

  try {
    const algod = new algosdk.Algodv2(process.env.ALGOD_TOKEN || '', ALGOD_URL);

    // Read V2 token registry
    const registry = await readV2TokenRegistry(algod);
    if (registry.length === 0) {
      return res.status(200).json({ boxFound: false });
    }

    // Read V2 box
    const boxState = await readV2Box(algod, wallet, registry.length);
    if (!boxState) {
      return res.status(200).json({ boxFound: false });
    }

    // For each registered token, compute claimable + check underfunding
    const tokens: V2TokenClaimable[] = [];
    for (const token of registry) {
      const state = boxState.tokens[token.index];
      if (!state) continue;

      const claimable = Number(state.entitled - state.claimed);

      // Check if V2 app is funded for this token
      let underfunded = false;
      if (claimable > 0) {
        try {
          const acctInfo = await algod.accountAssetInformation(V2_APP_ADDR, token.asaId).do();
          const balance = acctInfo['asset-holding'].amount ?? 0;
          if (balance < claimable) {
            underfunded = true;
          }
        } catch {
          underfunded = true; // App not opted in or error = treat as underfunded
        }
      }

      tokens.push({
        index: token.index,
        asaId: token.asaId,
        name: token.name,
        entitled: Number(state.entitled),
        matured: Number(state.matured),
        claimed: Number(state.claimed),
        claimable,
        underfunded,
      });
    }

    return res.status(200).json({
      boxFound: true,
      tokens,
    });
  } catch (err: any) {
    if (err?.status === 404 || err?.message?.includes('box not found')) {
      return res.status(200).json({ boxFound: false });
    }
    console.error('claimable-v2 fetch error:', err);
    return res.status(502).json({ boxFound: false });
  }
}
