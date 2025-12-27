import crypto from 'node:crypto';

type PlanType = 'monthly' | 'annual' | string;

export type DimoConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  authUrl: string; // legacy/generic OAuth (keep for fallback)
  tokenUrl: string; // legacy/generic OAuth (keep for fallback)
  loginBase?: string; // hosted Login with DIMO UI (preferred)
  jwksUrl?: string; // auth.dimo.zone keyset for UserJWT verification
  apiBase: string;
  announceAt: Date;
  graceDays: number;
  requireAnnualPostAnnounce: boolean;
  allowPostGrace: boolean;
  hashSecret: string;
  snapshotTtlMs: number;
  minerPrefix: string;
};

export type NormalizedSubscription = {
  subscriptionId: string;
  userId: string;
  plan: PlanType;
  status: string;
  startedAt: Date;
  renewalAt?: Date | null;
  // Capture trial end so eligibility can allow trialing_incomplete when still active.
  trialEndsAt?: Date | null;
  deviceAddress?: string | null;
  deviceTokenId?: string | number | null;
  deviceTokenDid?: string | null;
  deviceSerial?: string | null;
  vehicleTokenId?: string | number | null;
  vehicleDefinition?: Record<string, unknown> | null;
  deviceClaimedAt?: Date | null;
  deviceManufacturer?: string | null;
  raw: unknown;
};

const getBooleanEnv = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined) return defaultValue;
  if (['true', '1', 'yes', 'y'].includes(value.toLowerCase())) return true;
  if (['false', '0', 'no', 'n'].includes(value.toLowerCase())) return false;
  return defaultValue;
};

export const getDimoConfig = (): DimoConfig => {
  const {
    DIMO_CLIENT_ID,
    DIMO_CLIENT_SECRET,
    DIMO_REDIRECT_URI,
    DIMO_AUTH_URL,
    DIMO_TOKEN_URL,
    DIMO_API_BASE,
    DIMO_LOGIN_BASE,
    DIMO_JWKS_URL,
    DIMO_ANNOUNCE_UTC,
    DIMO_GRACE_DAYS,
    DIMO_REQUIRE_ANNUAL_POST_ANNOUNCE,
    DIMO_ALLOW_POST_GRACE,
    DIMO_HASH_SECRET,
    DIMO_SNAPSHOT_TTL_MINUTES,
    DIMO_MINER_PREFIX
  } = process.env;

  if (!DIMO_CLIENT_ID || !DIMO_CLIENT_SECRET || !DIMO_REDIRECT_URI || !DIMO_API_BASE) {
    throw new Error('DIMO configuration is incomplete. Ensure client id/secret, redirect URI, and API base are set.');
  }
  if (!DIMO_HASH_SECRET || DIMO_HASH_SECRET.length < 32) {
    throw new Error('DIMO_HASH_SECRET is required (min 32 chars) to hash DIMO identifiers securely.');
  }

  const announce = DIMO_ANNOUNCE_UTC ? new Date(DIMO_ANNOUNCE_UTC) : new Date('2025-11-28T00:00:00.000Z');
  const graceDays = Number.isFinite(Number(DIMO_GRACE_DAYS)) ? Number(DIMO_GRACE_DAYS) : 7;
  const snapshotTtlMinutes = Number.isFinite(Number(DIMO_SNAPSHOT_TTL_MINUTES))
    ? Number(DIMO_SNAPSHOT_TTL_MINUTES)
    : 10;

  return {
    clientId: DIMO_CLIENT_ID,
    clientSecret: DIMO_CLIENT_SECRET,
    redirectUri: DIMO_REDIRECT_URI,
    authUrl: DIMO_AUTH_URL ?? '',
    tokenUrl: DIMO_TOKEN_URL ?? '',
    loginBase: DIMO_LOGIN_BASE,
    jwksUrl: DIMO_JWKS_URL,
    apiBase: DIMO_API_BASE,
    announceAt: announce,
    graceDays,
    requireAnnualPostAnnounce: getBooleanEnv(DIMO_REQUIRE_ANNUAL_POST_ANNOUNCE, true),
    allowPostGrace: getBooleanEnv(DIMO_ALLOW_POST_GRACE, false),
    hashSecret: DIMO_HASH_SECRET,
    snapshotTtlMs: snapshotTtlMinutes * 60 * 1000,
    minerPrefix: DIMO_MINER_PREFIX || 'AEM'
  };
};

/**
 * HMAC the DIMO identifier to avoid storing raw ids.
 */
export const hashDimoId = (value: string, secret: string): string => {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
};

/**
 * Builds the DIMO OAuth URL with the standard query parameters.
 */
export const buildDimoAuthUrl = (state: string, config: DimoConfig): string => {
  // Prefer hosted Login with DIMO if provided, otherwise fall back to generic OAuth URL.
  const base = config.loginBase || config.authUrl;
  if (!base) {
    throw new Error('No DIMO auth/login base configured');
  }
  const url = new URL(base);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'openid profile subscriptions');
  return url.toString();
};
