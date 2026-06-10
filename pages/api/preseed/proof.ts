import type { NextApiRequest, NextApiResponse } from 'next';

const UPSTREAM = 'http://100.108.101.109:8084/api/merkle/proof';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { wallet } = req.query;
  if (!wallet || typeof wallet !== 'string') {
    return res.status(400).json({ error: 'wallet param required' });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const upstreamUrl = `${UPSTREAM}?wallet=${encodeURIComponent(wallet)}`;
    const upstreamRes = await fetch(upstreamUrl, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    clearTimeout(timeout);

    const body = await upstreamRes.text();
    res.status(upstreamRes.status);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Content-Type', 'application/json');
    res.send(body);
  } catch (err) {
    clearTimeout(timeout);
    res.status(502).json({ error: 'proof service unavailable' });
  }
}
