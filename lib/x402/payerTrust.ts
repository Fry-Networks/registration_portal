import type { NextApiRequest } from 'next';
import { timingSafeEqual } from 'crypto';

// Trust boundary for payer-scoped x402 routes.
// The payer address is asserted ONLY by the dashboard-x402 sidecar, which derives it
// from a facilitator-VERIFIED payment. The sidecar proves it is the caller by presenting
// the shared X402_INTERNAL_SECRET (never exposed to clients; the public edge additionally
// blocks /api/x402/*). No secret set -> fail closed (no route trusts any payer).
const SECRET = process.env.X402_INTERNAL_SECRET || '';
const ALGO_ADDR = /^[A-Z2-7]{58}$/;

function secretOk(req: NextApiRequest): boolean {
  if (!SECRET) return false; // fail closed
  const raw = req.headers['x-x402-internal'];
  const got = Array.isArray(raw) ? raw[0] : raw || '';
  // TextEncoder yields Uint8Array<ArrayBuffer> (assignable to timingSafeEqual's ArrayBufferView).
  const enc = new TextEncoder();
  const a = enc.encode(got);
  const b = enc.encode(SECRET);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Returns the facilitator-verified payer address the sidecar asserted, or null.
 * null MUST cause the route to 403 (never fall back to any other identity).
 */
export function trustedPayer(req: NextApiRequest): string | null {
  if (!secretOk(req)) return null;
  const raw = req.headers['x-payer-address'];
  const addr = (Array.isArray(raw) ? raw[0] : raw || '').trim();
  if (!ALGO_ADDR.test(addr)) return null;
  return addr;
}
