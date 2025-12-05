import { DimoConfig, NormalizedSubscription } from './config';

export type EligibilityResult = {
  eligible: boolean;
  reason: string;
  graceExpiresAt?: Date;
};

const normalizePlan = (plan: string): 'monthly' | 'annual' | string => {
  const lower = plan?.toLowerCase?.() ?? plan;
  if (lower === 'monthly') return 'monthly';
  if (lower === 'annual' || lower === 'yearly' || lower === 'year') return 'annual';
  return plan;
};

const isActiveStatus = (status: string): boolean => {
  const lower = status?.toLowerCase?.() ?? status;
  return ['active', 'trialing', 'trialing_active'].includes(lower);
};

/**
 * Applies the announced/grace policy to a subscription.
 */
export const evaluateEligibility = (
  subscription: NormalizedSubscription,
  config: DimoConfig
): EligibilityResult => {
  const plan = normalizePlan(subscription.plan);
  const startedAt = subscription.startedAt ? new Date(subscription.startedAt) : null;
  const announceAt = config.announceAt;
  const graceLimit = new Date(announceAt.getTime() + config.graceDays * 24 * 60 * 60 * 1000);

  if (!plan || plan === 'unknown') {
    return { eligible: false, reason: 'missing_plan' };
  }

  if (!startedAt || Number.isNaN(startedAt.valueOf())) {
    return { eligible: false, reason: 'missing_start' };
  }

  if (!isActiveStatus(subscription.status)) {
    return { eligible: false, reason: 'status_inactive' };
  }

  if (startedAt < announceAt) {
    return { eligible: true, reason: 'pre_announce', graceExpiresAt: graceLimit };
  }

  if (startedAt <= graceLimit) {
    if (plan === 'annual' || !config.requireAnnualPostAnnounce) {
      return { eligible: true, reason: 'grace_period', graceExpiresAt: graceLimit };
    }
    return { eligible: false, reason: 'grace_requires_annual', graceExpiresAt: graceLimit };
  }

  if (config.allowPostGrace) {
    return { eligible: true, reason: 'post_grace_allowed' };
  }

  return { eligible: false, reason: 'post_grace_rejected', graceExpiresAt: graceLimit };
};
