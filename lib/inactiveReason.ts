// RC9-UI. A bare "Inactive" dot on the device card told users nothing they could act on:
// owners of dead legacy clients (two reporters, 6 and 5 devices) had no way to tell a
// client that needs updating from a client that stopped reporting altogether.
//
// lib/deviceActivity.ts (getRewardEligibility) already derives WHY, and
// /api/devices/[miner_key] + /api/devices/batch already ship that verdict on the device as
// reward_block_reason / reward_poc_version_installed / reward_poc_version_required. This
// module only turns that verdict into copy: it is PURE — no database, no React, no fetch,
// no clock of its own beyond an injectable `now` — so the wording is unit-testable and can
// be rendered from the data the card already holds.
//
// It deliberately states NO threshold. The windows live in lib/deviceActivity.ts
// (15 min display / 24 h reward liveness) and in hardwareapi; duplicating a number here
// would be a second source of truth that silently drifts.

export type InactiveReasonInput = {
  /** device.is_active as shipped by /api/devices — a live device gets no label. */
  isActive?: boolean | null;
  /** device.reward_block_reason, i.e. RewardEligibility['reason']. */
  eligibility?: unknown;
  /** Last heartbeat we know about, if the caller has one. */
  lastSeenAt?: unknown;
  /** device.reward_poc_version_installed. */
  clientVersion?: unknown;
  /** device.reward_poc_version_required. */
  requiredVersion?: unknown;
  /** Injectable clock for tests. */
  now?: number;
};

const CHECK_THE_CLIENT = 'Check the device is powered on and the Fry Edge Miner client is running.';

const FALLBACK = `This device has not checked in recently. ${CHECK_THE_CLIENT}`;

const text = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const toMs = (raw: unknown): number | null => {
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = text(raw);
  if (!s) return null;
  const parsed = Date.parse(s);
  return Number.isFinite(parsed) ? parsed : null;
};

const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

/** Human last-seen age. Clamped at zero so a skewed device clock never prints a negative. */
export function lastSeenAgeLabel(lastSeenAt: unknown, now?: number): string | null {
  const ms = toMs(lastSeenAt);
  if (ms === null) return null;
  const reference = typeof now === 'number' && Number.isFinite(now) ? now : Date.now();
  const elapsed = Math.max(0, reference - ms);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  return plural(Math.floor(hours / 24), 'day');
}

/**
 * One short sentence explaining why a device reads Inactive, or null when it is live.
 * The caller decides whether to render it (the card gates on device.is_active === false).
 */
export function inactiveReasonLabel(input?: InactiveReasonInput | null): string | null {
  const opts = input && typeof input === 'object' ? input : {};
  if (opts.isActive === true) return null;

  const reason = text(opts.eligibility);
  if (reason === 'ok') return null;

  if (reason === 'update_required') {
    const installed = text(opts.clientVersion);
    const required = text(opts.requiredVersion);
    const have = installed ? `client ${installed}` : 'an older client version';
    const need = required ? `client ${required}` : 'a newer version';
    return `Update required: this device reports ${have} but ${need} is needed. Update Fry Edge Miner on the device to bring it back online.`;
  }

  if (reason === 'no_recent_heartbeat') {
    const age = lastSeenAgeLabel(opts.lastSeenAt, opts.now);
    return age
      ? `No heartbeat since ${age}. ${CHECK_THE_CLIENT}`
      : `No recent heartbeat has reached the server. ${CHECK_THE_CLIENT}`;
  }

  return FALLBACK;
}
