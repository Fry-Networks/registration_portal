import type { NextApiRequest, NextApiResponse } from 'next';
import { ALGOD_ALLOWLIST, algodUpstreams, proxyAlgorandRequest } from '../../../lib/algorand/nodeProxy';

// Raw body only: sendRawTransaction posts binary msgpack, and Next's JSON parser would corrupt it.
export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  await proxyAlgorandRequest(req, res, {
    rules: ALGOD_ALLOWLIST,
    upstreams: algodUpstreams(),
    token: process.env.ALGOD_TOKEN || undefined,
    tokenHeader: 'X-Algo-API-Token',
  });
}
