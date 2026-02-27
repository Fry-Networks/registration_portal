// Shared helpers for routing rewards between main and dbrewards with a fixed cutoff.
export type RewardsDbSource = 'main' | 'dbrewards';

// Hard cutoff for the split between legacy and current rewards.
export const REWARDS_CUTOFF_ISO = '2026-01-24T00:00:00.000Z';
export const REWARDS_CUTOFF_DATE = new Date(REWARDS_CUTOFF_ISO);

// Normalize potential date inputs while guarding against invalid values.
const normalizeDate = (value?: string | Date | null): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const isOnOrAfterRewardsCutoff = (value?: string | Date | null): boolean => {
  const date = normalizeDate(value);
  if (!date) return false;
  return date.getTime() >= REWARDS_CUTOFF_DATE.getTime();
};

export const isBeforeRewardsCutoff = (value?: string | Date | null): boolean => {
  const date = normalizeDate(value);
  if (!date) return false;
  return date.getTime() < REWARDS_CUTOFF_DATE.getTime();
};

// Resolve reward collection names per source and test mode.
export const resolveRewardsCollectionName = (
  source: RewardsDbSource,
  testMode: boolean
): string => {
  if (source === 'dbrewards') {
    return testMode ? 'test_device_rewards' : 'device_rewards';
  }
  return testMode ? 'test-device-rewards' : 'device-rewards';
};

// Extract the best-available timestamp for weekly rewards (used for cutoff routing).
export const getWeeklyRewardDate = (reward: any): Date | null => {
  return normalizeDate(reward?.unlock_at ?? reward?.created_at ?? null);
};

// Extract the best-available timestamp for daily rewards (used for cutoff routing).
export const getDailyRewardDate = (reward: any): Date | null => {
  return normalizeDate(reward?.created_at ?? reward?.date ?? null);
};
