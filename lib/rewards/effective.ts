// Truthful reward-amount helpers (F3 tie-in).
// The weekly publisher pays corrected_amount (falling back to amount) on rows
// that are claimable and NOT held (payout_hold / ghost_device /
// evidence_unavailable). UI totals must mirror that selection so users see the
// number that will actually be paid — not the stale precomputed total_claimable.

import type { Evidence } from './pocEvidence';
import { hasEvidenceInWindow } from './pocEvidence';

export type RewardRow = {
  status?: string;
  amount?: number;
  corrected_amount?: number;
  payout_hold?: boolean;
  ghost_device?: boolean;
  evidence_unavailable?: boolean;
  corrected_by?: unknown;
  // Set (with payout_hold) on rows neutralised as already-paid duplicates; such rows are
  // invisible to every user-facing total and list (oos3-dup-cleanup, 2026-09-11).
  voided_by?: unknown;
  week_start?: string | Date;
  week_end?: string | Date;
  date?: string | Date;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

export const effectiveAmount = (row: RewardRow): number =>
  typeof row?.corrected_amount === 'number' ? row.corrected_amount : Number(row?.amount ?? 0);

export const isHeld = (row: RewardRow): boolean =>
  row?.payout_hold === true || row?.ghost_device === true || row?.evidence_unavailable === true;

// A voided row is an already-paid duplicate (its `claimed` twin carries the tx_id). It is
// neither claimable nor "under review": it must not be shown or counted anywhere.
export const isVoided = (row: RewardRow): boolean =>
  typeof row?.voided_by === 'string' && row.voided_by.length > 0;

export function computeClaimableTotals(doc: any): { claimable: number; held: number } {
  let claimable = 0;
  let held = 0;
  const consider = (row: RewardRow) => {
    if (isVoided(row)) return;
    if (row?.status !== 'claimable') return;
    if (isHeld(row)) {
      held += effectiveAmount(row);
      return;
    }
    claimable += effectiveAmount(row);
  };
  if (Array.isArray(doc?.weekly_rewards)) for (const wr of doc.weekly_rewards) consider(wr);
  if (Array.isArray(doc?.daily_rewards)) for (const dr of doc.daily_rewards) consider(dr);
  return { claimable: round2(claimable), held: round2(held) };
}

// The A-gate as /api/rewards/claim applies it (claim.ts `_aGateOk`): a row carrying
// corrected_by was already evidence-verdicted by the F3-y/F3-z pass and is trusted; a row
// without it must have live PoC evidence inside its own epoch window or the claim path drops
// it. `deviceExempt` mirrors claim.ts's virtual-mining carve-out (an activated virtual device
// has no hardware, so it is PoC-exempt by design).
export const passesAGate = (
  row: RewardRow,
  ev: Evidence | undefined,
  deviceExempt: boolean,
  kind: 'weekly' | 'daily'
): boolean => {
  if (deviceExempt || row?.corrected_by) return true;
  if (!ev) return false;
  const start = kind === 'weekly' ? row.week_start : row.date;
  const end = kind === 'weekly' ? row.week_end : row.date;
  if (start === undefined || start === null || end === undefined || end === null) return false;
  return hasEvidenceInWindow(ev, new Date(start as any), new Date(end as any));
};

export const isDeviceAGateExempt = (device: any): boolean =>
  device?.virtual === true && device?.activated === true;

export type GatedTotals = {
  // What /api/rewards/claim will actually pay right now.
  claimable: number;
  // Rows blocked by payout_hold / ghost_device / evidence_unavailable.
  held: number;
  // Rows that are claimable+unheld but that the claim path drops for missing PoC evidence.
  // Surfaced separately so the UI can explain the gap instead of advertising a total the
  // claim endpoint then refuses with "No rewards available to claim."
  pendingEvidence: number;
};

// Per-asset variant of the above. Reward rows carry their own asset_id; bucketing a whole
// device into one asset (by miner-key prefix) mixes fNODE and tFRY into a single number.
export type GatedAssetTotals = GatedTotals & { byAsset: Record<string, GatedTotals> };

const emptyTotals = (): GatedTotals => ({ claimable: 0, held: 0, pendingEvidence: 0 });

export function computeGatedTotals(
  doc: any,
  ev: Evidence | undefined,
  deviceExempt = false
): GatedAssetTotals {
  const total = emptyTotals();
  const byAsset: Record<string, GatedTotals> = {};

  const bucketFor = (assetId: unknown): GatedTotals => {
    const key = String(assetId ?? 'unknown');
    if (!byAsset[key]) byAsset[key] = emptyTotals();
    return byAsset[key];
  };

  const consider = (row: any, kind: 'weekly' | 'daily') => {
    if (isVoided(row)) return;
    if (row?.status !== 'claimable') return;
    const amount = effectiveAmount(row);
    const bucket = bucketFor(row?.asset_id);
    if (isHeld(row)) {
      total.held += amount;
      bucket.held += amount;
      return;
    }
    if (!passesAGate(row, ev, deviceExempt, kind)) {
      total.pendingEvidence += amount;
      bucket.pendingEvidence += amount;
      return;
    }
    total.claimable += amount;
    bucket.claimable += amount;
  };

  if (Array.isArray(doc?.weekly_rewards)) for (const wr of doc.weekly_rewards) consider(wr, 'weekly');
  if (Array.isArray(doc?.daily_rewards)) for (const dr of doc.daily_rewards) consider(dr, 'daily');

  total.claimable = round2(total.claimable);
  total.held = round2(total.held);
  total.pendingEvidence = round2(total.pendingEvidence);
  for (const k of Object.keys(byAsset)) {
    byAsset[k].claimable = round2(byAsset[k].claimable);
    byAsset[k].held = round2(byAsset[k].held);
    byAsset[k].pendingEvidence = round2(byAsset[k].pendingEvidence);
  }

  return { ...total, byAsset };
}

// Per-asset pending/accruing straight off the rows, for the same reason as above: the
// doc-level total_pending is a single cross-asset number.
export function sumRowsByAssetForStatus(
  doc: any,
  statuses: string[],
  opts: { dailyDatesAllowed?: string[] } = {}
): Record<string, number> {
  const out: Record<string, number> = {};
  const add = (assetId: unknown, amount: number) => {
    const key = String(assetId ?? 'unknown');
    out[key] = round2((out[key] ?? 0) + amount);
  };
  if (Array.isArray(doc?.weekly_rewards)) {
    for (const wr of doc.weekly_rewards) {
      if (isVoided(wr)) continue;
      if (statuses.includes(wr?.status)) add(wr?.asset_id, effectiveAmount(wr));
    }
  }
  if (Array.isArray(doc?.daily_rewards)) {
    for (const dr of doc.daily_rewards) {
      if (isVoided(dr)) continue;
      if (!statuses.includes(dr?.status)) continue;
      if (opts.dailyDatesAllowed && !opts.dailyDatesAllowed.includes(dr?.date)) continue;
      add(dr?.asset_id, Number(dr?.amount ?? 0));
    }
  }
  return out;
}
