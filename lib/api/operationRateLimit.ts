import type { NextApiRequest, NextApiResponse } from 'next';
import { createApiError, ErrorCodes } from '../api-errors';
import type { DeviceAction } from '../db/requestLocks';
import { notifyDiscordError } from '../discord-webhook';

type OperationRateLimitConfig = {
  windowMs: number;
  max: number;
  burst: number;
};

const OPERATION_LIMITS: Partial<Record<DeviceAction, OperationRateLimitConfig>> = {
  'stake:registration': { windowMs: 10 * 60 * 1000, max: 3, burst: 1 },
  'stake:node': { windowMs: 10 * 60 * 1000, max: 3, burst: 1 },
  'stake:verification': { windowMs: 5 * 60 * 1000, max: 5, burst: 2 },
  claim: { windowMs: 60 * 1000, max: 20, burst: 5 },
  boost: { windowMs: 5 * 60 * 1000, max: 15, burst: 3 },
  'withdraw:verification': { windowMs: 60 * 60 * 1000, max: 10, burst: 2 },
  'withdraw:registration': { windowMs: 60 * 60 * 1000, max: 10, burst: 2 },
  'withdraw:node': { windowMs: 60 * 60 * 1000, max: 10, burst: 2 },
  // Users need to sweep dozens of devices during the FRY1 → FRY2 migration, so allow a high per-miner cadence.
  // 'withdraw:verification_check': { windowMs: 30 * 60 * 1000, max: 6, burst: 2 }
  'withdraw:verification_check': { windowMs: 5 * 60 * 1000, max: 60, burst: 10 }
};

type RateBucket = {
  count: number;
  resetAt: number;
  burstRemaining: number;
};

const buckets = new Map<string, RateBucket>();

type AlertTracker = {
  lastNotified: number;
  ttl: number;
};

// Track recent alerts per (action, miner_key) so Discord isn't spammed for the same device.
const alertTracker = new Map<string, AlertTracker>();

const shouldNotifyRateLimit = (key: string, now: number, ttl: number): boolean => {
  const entry = alertTracker.get(key);
  if (entry && now - entry.lastNotified < entry.ttl) {
    return false;
  }
  alertTracker.set(key, { lastNotified: now, ttl });
  return true;
};

const getClientIp = (req: NextApiRequest): string => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0];
  }
  return req.socket.remoteAddress || 'unknown';
};

const deriveBucketKey = (params: {
  action: DeviceAction;
  address: string;
  ip: string;
  minerKey?: string;
}) => {
  const { action, address, ip, minerKey } = params;
  // Withdraw precheck is read-only but can spike heavily when users batch legacy stake exits.
  // Key the limiter per miner so one wallet can sweep many devices without tripping the guard.
  if (action === 'withdraw:verification_check' && minerKey) {
    return `${action}:${minerKey}:${ip}`;
  }
  return `${action}:${address}:${ip}`;
};

type RateLimitStatus = {
  allowed: boolean;
  retryAfterMs?: number;
};

type EnforceParams = {
  req: NextApiRequest;
  res: NextApiResponse;
  action: DeviceAction;
  minerKey: string;
  address: string;
};

type EnforceResult = {
  allowed: boolean;
};

const evaluateRateLimit = (
  bucket: RateBucket | undefined,
  config: OperationRateLimitConfig,
  now: number
): RateLimitStatus => {
  if (!bucket || now >= bucket.resetAt) {
    return { allowed: true, retryAfterMs: 0 };
  }

  if (bucket.count < config.max || bucket.burstRemaining > 0) {
    return { allowed: true, retryAfterMs: 0 };
  }

  return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
};

export const peekOperationRateLimit = ({
  req,
  action,
  address,
  minerKey
}: {
  req: NextApiRequest;
  action: DeviceAction;
  address: string;
  minerKey?: string;
}): RateLimitStatus => {
  const config = OPERATION_LIMITS[action];
  if (!config) {
    return { allowed: true, retryAfterMs: 0 };
  }
  const ip = getClientIp(req);
  const key = deriveBucketKey({ action, address, ip, minerKey });
  const now = Date.now();
  const bucket = buckets.get(key);
  return evaluateRateLimit(bucket, config, now);
};

export const enforceOperationRateLimit = async ({
  req,
  res,
  action,
  minerKey,
  address
}: EnforceParams): Promise<EnforceResult> => {
  const config = OPERATION_LIMITS[action];
  if (!config) {
    return { allowed: true };
  }

  const ip = getClientIp(req);
  const key = deriveBucketKey({ action, address, ip, minerKey });
  const now = Date.now();

  let bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = {
      count: 0,
      resetAt: now + config.windowMs,
      burstRemaining: config.burst
    };
  }

  const currentStatus = evaluateRateLimit(bucket, config, now);
  if (currentStatus.allowed) {
    if (bucket.count < config.max) {
      bucket.count += 1;
    } else if (bucket.burstRemaining > 0) {
      bucket.burstRemaining -= 1;
    }
    buckets.set(key, bucket);
    return { allowed: true };
  }

  buckets.set(key, bucket);

  const retryAfterMs = currentStatus.retryAfterMs ?? 0;
  res.setHeader('Retry-After', Math.ceil(retryAfterMs / 1000));
  res.status(429).json(
    createApiError(
      ErrorCodes.RATE_LIMIT_EXCEEDED,
      `Too many ${action} requests. Please wait before trying again.`,
      `You can perform ${config.max} ${action} operations every ${Math.round(
        config.windowMs / 60000
      )} minutes.`
    )
  );

  const alertKey = `${action}:${minerKey || 'UNKNOWN_MINER_KEY'}`;
  // Reuse the action window as the TTL so ops gets at most one alert per device per limiter window.
  if (shouldNotifyRateLimit(alertKey, now, config.windowMs)) {
    await notifyDiscordError({
      minerKey,
      walletAddress: address,
      issueType: 'RATE_LIMIT_EXCEEDED',
      part: 'operationRateLimit',
      errorMessage: `Rate limit exceeded for ${action}`,
      metadata: {
        action,
        ip,
        windowMs: config.windowMs,
        max: config.max
      }
    });
  }

  return { allowed: false };
};
