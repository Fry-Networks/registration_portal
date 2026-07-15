// Truthful reward-amount helpers (F3 tie-in).
// The weekly publisher pays corrected_amount (falling back to amount) on rows
// that are claimable and NOT held (payout_hold / ghost_device /
// evidence_unavailable). UI totals must mirror that selection so users see the
// number that will actually be paid — not the stale precomputed total_claimable.

export type RewardRow = {
  status?: string;
  amount?: number;
  corrected_amount?: number;
  payout_hold?: boolean;
  ghost_device?: boolean;
  evidence_unavailable?: boolean;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

export const effectiveAmount = (row: RewardRow): number =>
  typeof row?.corrected_amount === 'number' ? row.corrected_amount : Number(row?.amount ?? 0);

export const isHeld = (row: RewardRow): boolean =>
  row?.payout_hold === true || row?.ghost_device === true || row?.evidence_unavailable === true;

export function computeClaimableTotals(doc: any): { claimable: number; held: number } {
  let claimable = 0;
  let held = 0;
  const consider = (row: RewardRow) => {
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
