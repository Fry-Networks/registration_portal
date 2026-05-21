import type { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';

const LOG_PATH = '/tmp/swap-errors.log';
const SENSITIVE_RE = /privateKey|mnemonic|seed|secret|token|password|session/i;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;

const rateLimitMap = new Map<string, number[]>();

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(ip) || [];
  const recent = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateLimitMap.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

function sanitizePayload(payload: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (SENSITIVE_RE.test(key)) continue;
    cleaned[key] = value;
  }
  return cleaned;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    return res.status(400).json({ success: false, error: 'Payload required' });
  }

  if (!payload.errorType || typeof payload.errorType !== 'string') {
    return res.status(400).json({ success: false, error: 'errorType required' });
  }

  if (!payload.message || typeof payload.message !== 'string') {
    return res.status(400).json({ success: false, error: 'message required' });
  }

  const ip = req.socket.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ success: false, error: 'Rate limit exceeded' });
  }

  const cleaned = sanitizePayload(payload);
  const line = `[${new Date().toISOString()}] ${JSON.stringify(cleaned)}\n`;

  try {
    fs.appendFileSync(LOG_PATH, line);
  } catch (err) {
    console.error('[swap/log] Failed to append to log file:', err);
  }

  // /tmp is ephemeral — container restart clears it.
  // console.error below writes to Docker logs, which is the durable capture path.
  console.error(JSON.stringify({ source: 'client-swap-log', ...cleaned }));

  return res.status(200).json({ logged: true });
}
