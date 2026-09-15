import type { NextApiRequest, NextApiResponse } from 'next';
import { INDEXER_ALLOWLIST, indexerUpstreams, proxyAlgorandRequest } from '../../../lib/algorand/nodeProxy';

export const config = { api: { bodyParser: false } };

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  await proxyAlgorandRequest(req, res, {
    rules: INDEXER_ALLOWLIST,
    upstreams: indexerUpstreams(),
    token: process.env.INDEXER_TOKEN || undefined,
    tokenHeader: 'X-Indexer-API-Token',
  });
}
