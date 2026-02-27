import { Button, Flex, Title, Dialog, DialogPanel } from '@tremor/react';
import { CalendarIcon, ClockIcon } from '@heroicons/react/outline';
import type { GetServerSidePropsContext } from 'next';
import bgImg from '../assets/background.png';
import HeroBanner from '../components/HeroBanner';
import { signOut, useSession } from 'next-auth/react';
import { getServerSession } from 'next-auth';
import { authOptions } from './api/auth/[...nextauth]';
import clientPromise from '../lib/mongoclient';
import rewardsClientPromise from '../lib/rewardsMongoClient';
import { Reward } from '../lib/types';
import { useRewardSummary } from '../lib/hooks/useRewardSummary';
import WeeklyCard, { WeeklyRewardView } from '../components/WeeklyCard';
import DailyRow, { DailyRewardView } from '../components/DailyRow';
import Link from 'next/link';
import { type ElementType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useTheme } from 'next-themes'; // Use theme to align hero styling with other pages
import { useModal } from '../app/modalcontext';
import ClaimModal from '../components/modals/Claim';
import BoostModal from '../components/modals/Boost';
import { getClientToken, refreshClientToken } from '../lib/clientToken';
import { generateRequestSignatureAsync } from '../lib/requestSignature.client';
import { useFingerprintReady } from '../app/fingerprintcontext';
import { fetchWithFingerprintRetry } from '../lib/api/fetchWithFingerprintRetry';
import {
  collectStakeHistory,
  type StakeEvent,
  type StakeHistoryMap
} from '../lib/history/collectStakeHistory';
import Tooltip from '../components/Tooltip';
import StatusPill from '../components/StatusPill';
import { REWARD_STATUS_DESCRIPTIONS, getAssetDisplay } from '../lib/utils';
import { isLegacyVerificationStake } from '../lib/legacyStake';
import { useToastContext } from '../hooks/ToastContext';
import { secureFetch } from '../lib/api/secureFetch';
import { isDeviceHealthSupported } from '../lib/minerKeyCategories';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider'; // Holiday-aware hero
import {
  getDailyRewardDate,
  getWeeklyRewardDate,
  isBeforeRewardsCutoff,
  isOnOrAfterRewardsCutoff,
  resolveRewardsCollectionName,
  RewardsDbSource
} from '../lib/rewardsDb';
// removed asset filter; keep utils unused import out

const FIVE_MINUTES = 5 * 60 * 1000;

function getThisFridayStartUTC(ref: Date): Date {
  const utc = new Date(Date.UTC(
    ref.getUTCFullYear(),
    ref.getUTCMonth(),
    ref.getUTCDate(),
    0,
    0,
    0,
    0
  ));
  const day = utc.getUTCDay();
  const diffToFriday = (day + 7 - 5) % 7;
  utc.setUTCDate(utc.getUTCDate() - diffToFriday);
  return utc;
}

function computeNextFrydayUnlock(now: Date): Date {
  const fridayStart = getThisFridayStartUTC(now);
  const thisUnlock = new Date(fridayStart.getTime() + FIVE_MINUTES);
  if (now.getTime() >= thisUnlock.getTime()) {
    return new Date(fridayStart.getTime() + 7 * 24 * 60 * 60 * 1000 + FIVE_MINUTES);
  }
  return thisUnlock;
}

// Normalize test mode flag to a strict boolean for type safety.
const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const NODE_PREFIXES = new Set(['RDN', 'SVN', 'SDN', 'CN']);
const AEM_PREFIX = 'AEM';

const PAGE_SIZE = 10;
const dayMs = 24 * 60 * 60 * 1000;
const sixMonthsMs = 180 * dayMs;
const devModeClient =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

type StakeCategory = 'verification' | 'registration' | 'node';

type StakeFieldSnapshot = {
  amount?: number | string;
  asset_id?: string;
  txId?: string;
  time?: string | Date;
  type?: string;
};

type StakeAvailability = {
  hasStake: boolean;
  available: boolean;
  availableAt?: Date | null;
  amount?: number;
  assetId?: string;
  lockType?: string;
};

type StakeAvailabilityMap = Record<StakeCategory, StakeAvailability>;

// Device Health history payload returned by /api/hardware/health-history.
type DeviceHealthHistory = {
  available: boolean;
  miner_key?: string | null;
  miner_type?: string | null;
  lastUpdated?: string | null;
  boot_time?: string | null;
  current_run_started_at?: string | null;
  poi_status?: boolean | null;
  software?: {
    os?: string;
    software_version_installed?: string;
    software_version_needed?: string;
    software_uptodate?: boolean;
    poc_version_installed?: string;
    poc_version_needed?: string;
    poc_uptodate?: boolean;
    is_uptodate?: boolean;
  } | null;
  rewards_multiplier_day?: number | null;
  rewards_multiplier_day_counted_slots?: number | null;
  rewards_multiplier_history?: Array<{ day: string; avg: number | null; counted_slots: number | null }>;
  tools_history?: Array<{ day: string; avgToolsCount: number | null; countedSlots: number }>;
};

const STAKE_LABELS: Record<StakeCategory, string> = {
  verification: 'Verification Stake',
  registration: 'Registration Stake',
  node: 'Node Operation Stake'
};

const STAKE_WITHDRAW_WARNINGS: Record<
  StakeCategory,
  { title: string; body: string; ack: string }
> = {
  verification: {
    title: 'Withdrawing removes your verification multiplier.',
    body: 'You will earn base rewards only until you re-stake with FRY\u00a02.0 and restore your multiplier bonus.',
    ack: 'I understand withdrawing removes my multiplier until I re-stake.'
  },
  registration: {
    title: 'CAUTION: Withdrawing stops device rewards.',
    body: 'Registration stake keeps this device eligible for payouts. Removing it pauses all earnings until you re-stake.',
    ack: 'I understand withdrawing registration stake stops rewards until I re-stake.'
  },
  node: {
    title: 'CAUTION: Withdrawing stops node earnings.',
    body: 'Node operation stake keeps your node active. Removing it pauses node rewards until you re-stake and resume operation.',
    ack: 'I understand withdrawing node stake pauses node earnings until I re-stake.'
  }
};

export default function History({
  initialRewards,
  initialTotalPages = 0,
  initialCounts
}: {
  initialRewards: Reward[];
  initialTotalPages?: number;
  initialCounts?: { weekly: number; daily: number };
}) {
  type RewardView = WeeklyRewardView | DailyRewardView;
  // Cache initial SSR payload once so CSR can build on top of it without round-tripping.
  const prefetchedRewards = initialRewards as unknown as RewardView[];
  const hasPrefetched = Array.isArray(prefetchedRewards) && prefetchedRewards.length > 0;
const prefetchedPageCount = hasPrefetched ? Math.max(1, Math.ceil(prefetchedRewards.length / PAGE_SIZE)) : 0;
const initialPage = hasPrefetched ? prefetchedPageCount : 0;
const initialTotal = initialTotalPages || (hasPrefetched ? prefetchedPageCount : 0);
  const initialWeeklyLoaded = prefetchedRewards.filter((r) => (r as any).isWeekly === true).length;
  const initialDailyLoaded = prefetchedRewards.length - initialWeeklyLoaded;

  // Stateful paging data the UI renders, seeded from the SSR results above.
  const [rewards, setRewards] = useState<RewardView[]>(prefetchedRewards);
  const [totalPages, setTotalPages] = useState(initialTotal);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [selReward, setSelReward] = useState<Reward | undefined>(undefined);
  const { openModal } = useModal();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false); // Guards the "Load more" button against double clicks.
  const currentPageRef = useRef(initialPage); // Keeps loadPage stable without re-defining the callback.
  const totalPagesRef = useRef(initialTotal);
  const [totalCounts, setTotalCounts] = useState<{ weekly: number; daily: number }>(() => ({
    weekly: initialCounts?.weekly ?? initialWeeklyLoaded,
    daily: initialCounts?.daily ?? initialDailyLoaded
  }));
  const [showFilters, setShowFilters] = useState(false);
  const [prices, setPrices] = useState<{ fry2?: number; fnode?: number }>({});
  const { data: session } = useSession();
  const toast = useToastContext();
  const [stakeHistoryData, setStakeHistoryData] = useState<StakeHistoryMap | null>(null);
  const [activeStakes, setActiveStakes] = useState<{
    verification?: StakeFieldSnapshot;
    registration?: StakeFieldSnapshot;
    node?: StakeFieldSnapshot;
  } | null>(null);
  const [productTokens, setProductTokens] = useState<any | null>(null);
const [legacyStakeUnlocked, setLegacyStakeUnlocked] = useState(false);
const [hasLegacyVerificationStake, setHasLegacyVerificationStake] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState<Partial<Record<StakeCategory, boolean>>>({});
  const [withdrawPrompt, setWithdrawPrompt] = useState<StakeCategory | null>(null);
  const [withdrawAcknowledged, setWithdrawAcknowledged] = useState(false);
  const [withdrawPromptLoading, setWithdrawPromptLoading] = useState(false);
  const [deviceRefreshToken, setDeviceRefreshToken] = useState(0);
  const [securityBlocked, setSecurityBlocked] = useState(false);
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);
  const securityToastShown = useRef(false);
  const hasStakeHistory = useMemo(() => {
    if (!stakeHistoryData) return false;
    return (
      stakeHistoryData.verification.length > 0 ||
      stakeHistoryData.registration.length > 0 ||
      stakeHistoryData.node.length > 0
    );
  }, [stakeHistoryData]);

  // Align hero palette with other pages by matching the current theme.
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const { activeHoliday } = useSeasonalTheme();
  const holidayKey = activeHoliday?.key ?? null;
  const heroOffsetClass = holidayKey === 'christmas' ? 'mt-10 sm:mt-14' : 'mt-2'; // Xmas: push hero down to clear garland

  const { miner_key } = router.query;
  const minerKey = typeof miner_key === 'string' ? miner_key : undefined;
  const isTFryMiner = useMemo(() => {
    if (!minerKey) return false;
    const prefix = minerKey.split('-')[0] || '';
    if (!prefix) return false;
    if (NODE_PREFIXES.has(prefix) || prefix === AEM_PREFIX) return false;
    return true;
  }, [minerKey]);
  // Gate Device Health so it only renders for AEM/BM/Nodes.
  const showDeviceHealthSection = useMemo(
    () => (typeof miner_key === 'string' ? isDeviceHealthSupported(miner_key) : false),
    [miner_key]
  );
  const { data: summary, mutate: mutateSummary } = useRewardSummary(minerKey);
  const [now, setNow] = useState(() => Date.now());
  const { ready: fingerprintReady, refresh: refreshFingerprint } = useFingerprintReady();
  const isLoadingAllRef = useRef(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const activeWithdrawWarning = withdrawPrompt ? STAKE_WITHDRAW_WARNINGS[withdrawPrompt] : null;

  const handleSecurityBlock = useCallback(
    (code?: string) => {
      if (securityToastShown.current) return;
      securityToastShown.current = true;

      const message =
        code === 'DEVICE_MISMATCH'
          ? 'Our system detected a security issue and signed you out to protect your account. Please reconnect with your device wallet to continue.'
          : 'Security verification failed. Please reconnect with your device wallet to continue.';

      setSecurityBlocked(true);
      setSecurityMessage(message);
      toast.error({ heading: 'Security check triggered', message });
      void signOut({ redirect: true, callbackUrl: '/signin' });
    },
    [toast]
  );

  // Mirror reactive state into refs so loadPage can stay memoised without re-running parent effects.
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);
  
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  const resolvedNextUnlock = useMemo(() => {
    if (summary?.nextUnlockAt) {
      const parsed = new Date(summary.nextUnlockAt);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return computeNextFrydayUnlock(new Date(now));
  }, [summary?.nextUnlockAt, now]);

  const formatSummaryValue = (value: unknown) => {
    if (value === null || value === undefined) return '0';
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value.toLocaleString();
    }
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value && 'toLocaleString' in value) {
      try {
        const result = (value as any).toLocaleString();
        if (typeof result === 'string') return result;
      } catch (error) {
        // noop
      }
    }
    return String(value ?? '0');
  };

  const formatLegacyAmount = (value: number) => {
    if (!Number.isFinite(value)) return '0';
    return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const unlockMessaging = useMemo(() => {
    if (!resolvedNextUnlock) return null;
    const diff = resolvedNextUnlock.getTime() - now;
    if (diff <= 0) {
      return {
        headline: 'Weekly rewards unlocked',
        detail: resolvedNextUnlock.toUTCString()
      };
    }
    const totalMinutes = Math.ceil(diff / 60000);
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = Math.max(totalMinutes % 60, 0);
    const segments: string[] = [];
    if (days > 0) segments.push(`${days}d`);
    if (hours > 0 || days > 0) segments.push(`${hours}h`);
    segments.push(`${minutes}m`);
    return {
      headline: `Unlocks in ${segments.join(' ')}`,
      detail: resolvedNextUnlock.toUTCString()
    };
  }, [resolvedNextUnlock, now]);

  type RewardsPageResult = {
    items: RewardView[];
    totalPages?: number;
    weeklyCount?: number;
    dailyCount?: number;
    totalCount?: number;
  } | null;

  const fetchRewardsPage = useCallback(
    async (targetPage: number): Promise<RewardsPageResult> => {
      if (!fingerprintReady) return null;
      if (!minerKey) return null;
      try {
        const refreshClientTokenOnce = async () => {
          try {
            await refreshClientToken();
            return true;
          } catch (error) {
            console.error('[ClientToken] Failed to refresh token for rewards page', error);
            return false;
          }
        };

        const response = await fetchWithFingerprintRetry(
          async () => {
            const body = { miner_key: minerKey, page: targetPage };
            const timestamp = Math.floor(Date.now() / 1000);
            const signature = await generateRequestSignatureAsync('POST', '/api/rewards/get-rewards-page', body, timestamp);
            const clientToken = await getClientToken();

            return fetch('api/rewards/get-rewards-page', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-client-token': clientToken,
                'x-request-signature': signature,
                'x-request-timestamp': timestamp.toString()
              },
              body: JSON.stringify(body)
            });
          },
          refreshFingerprint,
          { refreshClientToken: refreshClientTokenOnce }
        );

        if (!response.ok) {
          let errorCode: string | undefined;
          try {
            const payload = await response.clone().json();
            errorCode = typeof payload?.code === 'string' ? payload.code : undefined;
          } catch {
            errorCode = undefined;
          }
          if (errorCode === 'DEVICE_MISMATCH' || errorCode === 'DEVICE_FINGERPRINT_REFRESH') {
            handleSecurityBlock(errorCode);
            return null;
          }
          console.error('Failed to fetch rewards page', response.status);
          return null;
        }

        const result = await response.json();
        const items: RewardView[] = Array.isArray(result.items) ? result.items : [];
        return {
          items,
          totalPages: typeof result.totalPages === 'number' ? result.totalPages : undefined,
          weeklyCount: typeof result.weeklyCount === 'number' ? result.weeklyCount : undefined,
          dailyCount: typeof result.dailyCount === 'number' ? result.dailyCount : undefined,
          totalCount: typeof result.totalCount === 'number' ? result.totalCount : undefined
        };
      } catch (error) {
        console.error('Failed to fetch rewards page', error);
        return null;
      }
    },
    [fingerprintReady, minerKey, refreshFingerprint, handleSecurityBlock]
  );

  const applyPageData = useCallback(
    (result: Exclude<RewardsPageResult, null>, targetPage: number, replace: boolean): boolean => {
      const { items, weeklyCount, dailyCount, totalCount, totalPages: totalPagesHint } = result;

      setTotalCounts((prev) => ({
        weekly: typeof weeklyCount === 'number' ? weeklyCount : prev.weekly,
        daily: typeof dailyCount === 'number' ? dailyCount : prev.daily
      }));

      setRewards((prev) => {
        if (replace || targetPage === 1) {
          return items;
        }
        const existing = new Set(prev.map((p: any) => p._id));
        const deduped = items.filter((it: any) => !existing.has(it._id));
        return deduped.length > 0 ? [...prev, ...deduped] : prev;
      });

      const hasItems = items.length > 0;
      const totalFromCount = typeof totalCount === 'number' ? Math.max(Math.ceil(totalCount / PAGE_SIZE), 1) : undefined;
      const totalFromHint = typeof totalPagesHint === 'number' ? Math.max(totalPagesHint, 1) : undefined;
      const resolvedTotal = totalFromCount ?? totalFromHint;
      if (resolvedTotal) {
        totalPagesRef.current = resolvedTotal;
        setTotalPages(resolvedTotal);
      }

      if (replace) {
        const nextPage = hasItems ? targetPage : 0;
        currentPageRef.current = nextPage;
        setCurrentPage(nextPage);
      } else if (hasItems) {
        currentPageRef.current = targetPage;
        setCurrentPage(targetPage);
      }

      if (!hasItems && !replace && targetPage > 1) {
        const fallback = Math.max(targetPage - 1, 1);
        currentPageRef.current = fallback;
        setCurrentPage((prev) => (prev > fallback ? fallback : prev));
      }

      return hasItems;
    },
    []
  );

  // Unified loader powering initial fetches and manual page advances.
  const loadPage = useCallback(
    async (targetPage: number, options: { replace?: boolean } = {}) => {
      if (!minerKey) return;
      const { replace = false } = options;
      const current = currentPageRef.current;
      const total = totalPagesRef.current;
      if (!replace && targetPage <= current) return;
      if (!replace && total && targetPage > total) return;

      setIsLoading(true);
      if (!replace) setIsFetchingNextPage(true);
      try {
        const result = await fetchRewardsPage(targetPage);
        if (result) {
          applyPageData(result, targetPage, replace);
        }
      } catch (error) {
        console.error('Failed to fetch rewards page', error);
      } finally {
        setIsFetchingNextPage(false);
        setIsLoading(false);
      }
    },
    [minerKey, fetchRewardsPage, applyPageData]
  );

  const handleClaimButton = (reward: Reward) => {
    console.log('Claim Button');
    setSelReward(reward);
    openModal('claim');
  };

  const handleClaim = async (ret: boolean, message: string): Promise<void> => {
    console.log('Claim Action');
    if (!minerKey) return;
    setCurrentPage(0);
    setTotalPages(0);
    setRewards([]);
    currentPageRef.current = 0;
    totalPagesRef.current = 0;
    setTotalCounts({ weekly: 0, daily: 0 });
    await loadPage(1, { replace: true });
    if (mutateSummary) await mutateSummary();
  };

  const handleBoostButton = (reward: Reward) => {
    console.log('Boost Button');
    setSelReward(reward);
    openModal('boost');
  };

  const handleBoost = async (ret: boolean, message: string): Promise<void> => {
    console.log('Boost Action');
    if (!minerKey) return;
    setCurrentPage(0);
    setTotalPages(0);
    setRewards([]);
    currentPageRef.current = 0;
    totalPagesRef.current = 0;
    setTotalCounts({ weekly: 0, daily: 0 });
    await loadPage(1, { replace: true });
    if (mutateSummary) await mutateSummary();
  };

  // Reset and fetch on miner_key change (use SSR payload if present)
  useEffect(() => {
    const rewardViews = initialRewards as unknown as RewardView[];
    const prefetched = Array.isArray(rewardViews) && rewardViews.length > 0;
    const prefetchedPages = prefetched ? Math.max(1, Math.ceil(rewardViews.length / PAGE_SIZE)) : 0;
    const pageValue = prefetched ? prefetchedPages : 0;
    const totalValue = initialTotalPages || (prefetched ? prefetchedPages : 0);
    const weeklyLoaded = prefetched ? rewardViews.filter((r) => (r as any).isWeekly === true).length : 0;
    const dailyLoaded = prefetched ? rewardViews.length - weeklyLoaded : 0;

    setRewards(prefetched ? rewardViews : []);
    setCurrentPage(pageValue);
    currentPageRef.current = pageValue;
    setTotalPages(totalValue);
    totalPagesRef.current = totalValue;
    setTotalCounts({
      weekly: initialCounts?.weekly ?? weeklyLoaded,
      daily: initialCounts?.daily ?? dailyLoaded
    });

    if (!prefetched && minerKey && fingerprintReady) {
      loadPage(1, { replace: true });
    }
  }, [fingerprintReady, minerKey, initialRewards, initialTotalPages, initialCounts, loadPage]);

  // Fetch live prices for header context
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch('/api/price/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset_ids: ['2485314946', '2485202024'] })
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        setPrices({
          fry2: json?.prices?.['2485314946'] ?? 0,
          fnode: json?.prices?.['2485202024'] ?? 0
        });
      } catch {}
    };
    run();
    const id = setInterval(run, 300000);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Device identity (nickname/name and product name)
  const [deviceMeta, setDeviceMeta] = useState<{ nickname?: string; name?: string; productName?: string } | null>(null);
  // Device Health history is populated for AEM/BM/Nodes only.
  const [deviceHealthHistory, setDeviceHealthHistory] = useState<DeviceHealthHistory | null>(null);
  const [deviceHealthLoading, setDeviceHealthLoading] = useState(false);
  const [deviceHealthError, setDeviceHealthError] = useState<string | null>(null);
  useEffect(() => {
    if (typeof miner_key !== 'string' || !session?.user?.address) {
      setStakeHistoryData(null);
      return;
    }
    let active = true;
    setStakeHistoryData(null);
    setActiveStakes(null);
    setProductTokens(null);
    setLegacyStakeUnlocked(false);
    setHasLegacyVerificationStake(false);
    (async () => {
      try {
        const res = await fetchWithFingerprintRetry(
          () =>
            fetch(`/api/devices/${miner_key}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address: session.user.address })
            }),
          refreshFingerprint
        );
        if (!active) return;
        if (!res.ok) {
          let errorCode: string | undefined;
          try {
            const payload = await res.clone().json();
            errorCode = typeof payload?.code === 'string' ? payload.code : undefined;
          } catch {
            errorCode = undefined;
          }
          if (errorCode === 'DEVICE_MISMATCH' || errorCode === 'DEVICE_FINGERPRINT_REFRESH') {
            handleSecurityBlock(errorCode);
            return;
          }
          return;
        }
        const json = await res.json();
        const deviceDetail = json?.device;
        const nick = deviceDetail?.nickname;
        const name = deviceDetail?.name;
        let productName: string | undefined = undefined;
        try {
          const pr = await fetch('/api/products/get-product', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ miner_key })
          });
          if (pr.ok) {
            const pj = await pr.json();
            productName = pj?.data?.[0]?.name;
            setProductTokens(pj?.data?.[0]?.reward?.tokens ?? null);
          }
        } catch {}
        if (!active) return;
        setStakeHistoryData(collectStakeHistory(deviceDetail));
        setActiveStakes({
          verification: deviceDetail?.staked ?? undefined,
          registration: deviceDetail?.registration ?? undefined,
          node: deviceDetail?.node ?? undefined
        });
        setLegacyStakeUnlocked(Boolean(deviceDetail?.legacy_stake_unlocked));
        setHasLegacyVerificationStake(Boolean(deviceDetail && isLegacyVerificationStake(deviceDetail)));
        setDeviceMeta({ nickname: nick, name, productName });
      } catch {}
    })();
    return () => { active = false; };
  }, [miner_key, session?.user?.address, refreshFingerprint, deviceRefreshToken, handleSecurityBlock]);

  useEffect(() => {
    if (typeof miner_key !== 'string' || !session?.user?.address) {
      setDeviceHealthHistory(null);
      setDeviceHealthError(null);
      setDeviceHealthLoading(false);
      return;
    }

    if (!isDeviceHealthSupported(miner_key)) {
      setDeviceHealthHistory(null);
      setDeviceHealthError(null);
      setDeviceHealthLoading(false);
      return;
    }

    let active = true;
    setDeviceHealthLoading(true);
    setDeviceHealthError(null);

    (async () => {
      try {
        const res = await fetchWithFingerprintRetry(
          () => secureFetch('/api/hardware/health-history', { miner_key, days: 7 }),
          refreshFingerprint
        );
        if (!active) return;

        if (!res.ok) {
          throw new Error(`Health history request failed (${res.status})`);
        }

        const json = await res.json();
        if (!active) return;

        setDeviceHealthHistory({
          available: Boolean(json?.available),
          miner_key: json?.miner_key ?? null,
          miner_type: json?.miner_type ?? null,
          lastUpdated: json?.lastUpdated ?? null,
          boot_time: json?.boot_time ?? null,
          current_run_started_at: json?.current_run_started_at ?? null,
          poi_status: typeof json?.poi_status === 'boolean' ? json.poi_status : null,
          software: json?.software ?? null,
          rewards_multiplier_day:
            typeof json?.rewards_multiplier_day === 'number' ? json.rewards_multiplier_day : null,
          rewards_multiplier_day_counted_slots:
            typeof json?.rewards_multiplier_day_counted_slots === 'number'
              ? json.rewards_multiplier_day_counted_slots
              : null,
          rewards_multiplier_history: Array.isArray(json?.rewards_multiplier_history)
            ? json.rewards_multiplier_history
            : [],
          tools_history: Array.isArray(json?.tools_history) ? json.tools_history : []
        });
      } catch (error) {
        console.error('Failed to load device health history', error);
        if (!active) return;
        setDeviceHealthHistory(null);
        setDeviceHealthError('Device Health history is not available yet.');
      } finally {
        if (active) {
          setDeviceHealthLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [miner_key, refreshFingerprint, session?.user?.address]);

  // (moved) Infinite scroll observer defined after derived lists for type safety

  // Derived tabs and filters
  const [tab, setTab] = useState<'weekly' | 'daily'>('weekly');
  const [status, setStatus] = useState<'all' | 'pending' | 'claimable' | 'claimed'>('all');
  // Declarative tab metadata keeps the button rendering tidy and ensures icon + label stay in sync.
  const tabOptions: Array<{ key: 'weekly' | 'daily'; label: string; icon: ElementType }> = [
    { key: 'weekly', label: 'Weekly', icon: CalendarIcon },
    { key: 'daily', label: 'Legacy Daily', icon: ClockIcon }
  ];
  // Status filters share the same rendering path; define them here with their color cues.
  const statusOptions: Array<{
    key: 'all' | 'pending' | 'claimable' | 'claimed';
    label: string;
    dotClass: string;
  }> = [
    { key: 'all', label: 'All', dotClass: 'bg-gray-400' },
    { key: 'pending', label: 'Pending', dotClass: 'bg-amber-400' },
    { key: 'claimable', label: 'Claimable', dotClass: 'bg-emerald-400' },
    { key: 'claimed', label: 'Claimed', dotClass: 'bg-sky-400' }
  ];
  // Removed asset filter; using miner dropdown instead
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');

  const itemsWeekly: WeeklyRewardView[] = (rewards || []).filter((r): r is WeeklyRewardView => (r as any).isWeekly === true);
  const itemsDaily: DailyRewardView[] = (rewards || []).filter((r): r is DailyRewardView => (r as any).isWeekly !== true);
  // const allAssets = Array.from(new Set((rewards || []).map((r) => r.asset_id))).filter((id) => id);

  const stakeAvailability = useMemo<StakeAvailabilityMap>(() => {
    const defaultEntry = { hasStake: false, available: false };
    const map: StakeAvailabilityMap = {
      verification: { ...defaultEntry },
      registration: { ...defaultEntry },
      node: { ...defaultEntry }
    };

    const parseAmount = (value: any): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const setEntry = (type: StakeCategory, info: Partial<StakeAvailability>) => {
      map[type] = { ...map[type], ...info, hasStake: true };
    };

    const verification = activeStakes?.verification;
    if (verification) {
      const amount = parseAmount(verification.amount);
      const stakeTime = verification.time ? new Date(verification.time).getTime() : NaN;
      if (amount && amount > 0 && Number.isFinite(stakeTime)) {
        const lockType = verification.type === 'two' ? 'two' : 'one';
        const unlockAt =
          lockType === 'two'
            ? new Date(stakeTime + sixMonthsMs)
            : new Date(stakeTime + dayMs);
        const productStakeAsset = productTokens?.stake;
        const assetId = verification.asset_id ? String(verification.asset_id) : undefined;
        const assetMismatch =
          assetId && productStakeAsset ? String(assetId) !== String(productStakeAsset) : false;
        const available =
          devModeClient ||
          legacyStakeUnlocked ||
          assetMismatch ||
          Date.now() >= unlockAt.getTime();
        setEntry('verification', {
          amount,
          assetId,
          lockType,
          available,
          availableAt: unlockAt
        });
      }
    }

    const registration = activeStakes?.registration;
    if (registration) {
      const amount = parseAmount(registration.amount);
      if (amount && amount > 0) {
        setEntry('registration', {
          amount,
          assetId: registration.asset_id ? String(registration.asset_id) : undefined,
          available: true,
          availableAt: null
        });
      }
    }

    const node = activeStakes?.node;
    if (node) {
      const amount = parseAmount(node.amount);
      if (amount && amount > 0) {
        setEntry('node', {
          amount,
          assetId: node.asset_id ? String(node.asset_id) : undefined,
          available: true,
          availableAt: null
        });
      }
    }

    return map;
  }, [activeStakes, productTokens, legacyStakeUnlocked]);

  const submitWithdraw = useCallback(
    async (type: StakeCategory): Promise<boolean> => {
      if (!session?.user?.address || typeof miner_key !== 'string') {
        toast.error({
          heading: 'Withdraw Error',
          message: 'Select a device and ensure you are signed in before withdrawing.'
        });
        return false;
      }

      const endpointMap: Record<StakeCategory, string> = {
        verification: '/api/stake/stake-withdraw',
        registration: '/api/stake/r-withdraw',
        node: '/api/stake/n-withdraw'
      };

      setWithdrawLoading((prev) => ({ ...prev, [type]: true }));
      try {
        const res = await secureFetch(endpointMap[type], {
          address: session.user.address,
          miner_key
        });
        const payload = await res.json().catch(() => ({}));
        if (!res.ok) {
          toast.error({
            heading: 'Withdraw Error',
            message: payload?.message || 'Server error. Please try again.'
          });
          return false;
        }

        toast.success({
          heading: 'Withdraw submitted',
          message: payload?.txId ? `Tx: ${payload.txId}` : 'Withdrawal completed.'
        });
        setDeviceRefreshToken((token) => token + 1);
        return true;
      } catch (error) {
        console.error('[history] withdraw failed', error);
        toast.error({
          heading: 'Withdraw Error',
          message: 'Unable to submit withdrawal. Please try again.'
        });
        return false;
      } finally {
        setWithdrawLoading((prev) => ({ ...prev, [type]: false }));
      }
    },
    [miner_key, session?.user?.address, toast]
  );

  const handleWithdrawRequest = useCallback((type: StakeCategory) => {
    setWithdrawPrompt(type);
    setWithdrawAcknowledged(false);
  }, []);

  const closeWithdrawPrompt = useCallback(() => {
    if (withdrawPromptLoading) return;
    setWithdrawPrompt(null);
    setWithdrawAcknowledged(false);
  }, [withdrawPromptLoading]);

  const confirmWithdraw = useCallback(async () => {
    if (!withdrawPrompt) return;
    setWithdrawPromptLoading(true);
    const success = await submitWithdraw(withdrawPrompt);
    setWithdrawPromptLoading(false);
    if (success) {
      setWithdrawPrompt(null);
      setWithdrawAcknowledged(false);
    }
  }, [submitWithdraw, withdrawPrompt]);


  const applyFilters = <T extends RewardView>(list: T[]) => {
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00Z').getTime() : undefined;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59Z').getTime() : undefined;
    return list.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      // asset filter removed
      const ts = new Date(r.createdAt as any).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts > toTs) return false;
      return true;
    });
  };

  const applySort = <T extends RewardView>(list: T[]): T[] => {
    if (sort === 'oldest') {
      return ([...list].sort((a: any, b: any) =>
        new Date(a.createdAt as any).getTime() - new Date(b.createdAt as any).getTime()
      )) as T[];
    }
    // newest
    return ([...list].sort((a: any, b: any) =>
      new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()
    )) as T[];
  };

  const weeklyFiltered = applyFilters(itemsWeekly);
  const dailyFiltered = applyFilters(itemsDaily);
  const weeklyList = applySort(weeklyFiltered);
  const dailyList = applySort(dailyFiltered);
  const list = tab === 'weekly' ? weeklyList : dailyList;

  // Removed asset filter defaulting

  // Matures soon count (<=3 days left) only for weekly pending
  const maturesSoon = useMemo(() => {
    const now = Date.now();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    return itemsWeekly.filter((w) => w.status === 'pending' && (new Date(w.etaDate).getTime() - now) <= threeDaysMs).length;
  }, [itemsWeekly]);

  const loadedWeekly = useMemo(
    () => rewards.filter((r) => (r as any).isWeekly === true).length,
    [rewards]
  );
  const loadedDaily = rewards.length - loadedWeekly;
  const weeklyRemaining = Math.max(totalCounts.weekly - loadedWeekly, 0);
  const dailyRemaining = Math.max(totalCounts.daily - loadedDaily, 0);
  const isAllDataLoaded = weeklyRemaining === 0 && dailyRemaining === 0;
  // Manual advancement keeps paging predictable on complex mobile layouts (avoids intersection-observer jitter).
  const handleLoadAll = useCallback(async () => {
    if (!minerKey || isAllDataLoaded || isLoadingAllRef.current) return;
    isLoadingAllRef.current = true;
    setIsLoadingAll(true);
    setIsFetchingNextPage(true);
    setIsLoading(true);
    try {
      if (currentPageRef.current === 0) {
        const first = await fetchRewardsPage(1);
        if (first) applyPageData(first, 1, true);
      }
      while (true) {
        const nextPage = currentPageRef.current + 1;
        const total = totalPagesRef.current;
        if (total && nextPage > total) break;
        const result = await fetchRewardsPage(nextPage);
        if (!result) break;
        const hasItems = applyPageData(result, nextPage, false);
        if (!hasItems) break;
        if (totalPagesRef.current && nextPage >= totalPagesRef.current) break;
      }
    } finally {
      isLoadingAllRef.current = false;
      setIsLoadingAll(false);
      setIsFetchingNextPage(false);
      setIsLoading(false);
    }
  }, [applyPageData, fetchRewardsPage, isAllDataLoaded, minerKey]);

  useEffect(() => {
    if ((dateFrom || dateTo) && !isAllDataLoaded && !isLoadingAll) {
      handleLoadAll();
    }
  }, [dateFrom, dateTo, isAllDataLoaded, isLoadingAll, handleLoadAll]);

  return (
    <div className="w-full space-y-6">
      <div className={`px-2 sm:px-20 ${heroOffsetClass}`}>
        <HeroBanner
          title="Reward History"
          subtitle="Explore detailed payouts, confirm on-chain settlements, and keep Fry earnings aligned across devices."
          backgroundImage={bgImg}
          links={[
            {
              label: 'About FIP-009 (Switch from daily to weekly rewards)',
              href: 'https://vote.frynetworks.com/allvotes'
            }
          ]}
          mode={isDark ? 'dark' : 'light'} // Match devices/main page palette for consistency
          holidayKey={holidayKey}
        />
      </div>
      {securityBlocked && (
        <div className="mx-2 sm:mx-20 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          <strong>Security check triggered.</strong>{' '}
          {securityMessage ?? 'Please reconnect with your device wallet to continue.'}
        </div>
      )}
      <div className="px-2 sm:px-20">
        <Link href="/devices">
          <Button className="mt-6 min-w-[150px] bg-transparent border-red-600 text-slate-900 dark:text-white hover:bg-red-600 hover:border-red-600 hover:text-white">
            Back
          </Button>
        </Link>
      </div>
      {/* Device selector (combined with identity area) */}
      <div className="px-2 sm:px-20 mt-3 flex justify-center">
        <div className="w-full max-w-2xl">
          <MinerSelect />
        </div>
      </div>
      {/* Device identity */}
  {deviceMeta && (
    <div className="px-2 sm:px-20 mt-3 text-gray-900 dark:text-gray-300">
      <div className="text-lg sm:text-xl font-semibold text-gray-900 dark:text-white">
        {deviceMeta.nickname || deviceMeta.name || '-'}
        {typeof miner_key === 'string' && (
          <span className="text-gray-700 dark:text-gray-400 font-normal"> {' '}({miner_key})</span>
        )}
      </div>
      {deviceMeta.productName && (
        <div className="text-sm mt-1 text-gray-700 dark:text-gray-400">
          Product: <span className="font-semibold text-gray-900 dark:text-white">{deviceMeta.productName}</span>
        </div>
      )}
    </div>
  )}
  <div className="px-2 sm:px-20 mt-4 text-white border-b border-white/10 py-3">
    {summary && (
      <>
      <div className="flex flex-wrap gap-2">
        {/* Summary chips reuse shared StatusPill for consistent styling */}
        <StatusPill
          label="Accruing (weekly preview)"
          value={formatSummaryValue(summary.accruing ?? 0)}
          tone="info"
          tooltip={REWARD_STATUS_DESCRIPTIONS.accruing}
        />
        <StatusPill
          label="Pending"
          value={formatSummaryValue(summary.pending ?? 0)}
          tone="warning"
          tooltip={REWARD_STATUS_DESCRIPTIONS.pending}
        />
        <StatusPill
          label="Claimable"
          value={formatSummaryValue(summary.claimable ?? 0)}
          tone="success"
          tooltip={REWARD_STATUS_DESCRIPTIONS.claimable}
        />
        {typeof summary.claimed === 'number' && (
          <StatusPill
            label="Claimed"
            value={formatSummaryValue(summary.claimed)}
            tone="muted"
          />
        )}
      </div>
      {isTFryMiner && typeof summary.legacyFryClaimedSnapshot === 'number' && (
        // Light-mode friendly legacy card while keeping dark-mode contrast.
        <div className="mt-4 rounded-2xl border border-amber-400/60 bg-amber-50 text-amber-900 p-4 shadow-sm dark:border-yellow-400/40 dark:bg-yellow-500/10 dark:text-yellow-100">
          <div className="text-xs uppercase tracking-wide font-semibold text-amber-800 dark:text-yellow-200/80">
            Legacy Fry 1.0 Claimed - 12/13/2024 to 10/08/2025
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {formatLegacyAmount(summary.legacyFryClaimedSnapshot)} FRY 1.0
          </div>
          <p className="mt-1 text-xs text-amber-800/80 dark:text-yellow-200/80">
            Historical FRY 1.0 payouts claimed before the tFry migration. These are shown for context only and are not included in the tFry totals above.
          </p>
        </div>
      )}
      </>
    )}
  </div>
  {hasLegacyVerificationStake && (
    <div className="px-2 sm:px-20 mt-4">
      <div className="rounded-2xl border border-amber-400/60 bg-gradient-to-br from-amber-600/20 via-amber-400/10 to-transparent px-4 py-4 text-amber-100 shadow-inner shadow-amber-900/30">
        <div className="text-xs uppercase tracking-[0.35em] text-amber-200/80">Legacy FRY 1.0 stake detected</div>
        <p className="mt-2 text-sm text-amber-100">
          Legacy FRY 1.0 verification stake detected. Withdraw the legacy stake and re-stake with FRY 2.0 to keep multiplier rewards.
        </p>
      </div>
    </div>
  )}
  {showDeviceHealthSection && (
    <div className="px-2 sm:px-20 mt-6">
      <DeviceHealthSection
        history={deviceHealthHistory}
        loading={deviceHealthLoading}
        error={deviceHealthError}
        isDark={isDark}
      />
    </div>
  )}
  {(hasStakeHistory || Object.values(stakeAvailability).some((entry) => entry.hasStake)) && (
    <div className="px-2 sm:px-20 mt-6">
      <StakeHistorySection
        history={stakeHistoryData}
        availability={stakeAvailability}
        onWithdraw={handleWithdrawRequest}
        withdrawLoading={withdrawLoading}
        isDark={isDark}
      />
    </div>
  )}
  <Dialog
    open={Boolean(withdrawPrompt)}
    onClose={closeWithdrawPrompt}
    static={true}
    className="z-[200]"
  >
    {withdrawPrompt && activeWithdrawWarning && (
      <DialogPanel
        className={`sm:max-w-xl ${isDark ? 'bg-gray-900 text-gray-100' : 'bg-white text-slate-900'}`}
        style={{ marginTop: 'calc(var(--navbar-height, 64px) + 12px)' }}
      >
        <Title className={`mb-4 ${isDark ? 'text-gray-100' : 'text-slate-900'}`}>
          Withdraw {STAKE_LABELS[withdrawPrompt]}
        </Title>
        <div className={`rounded-2xl border px-4 py-3 text-sm ${isDark ? 'border-amber-400/50 bg-amber-500/10 text-amber-100' : 'border-amber-300 bg-amber-50 text-slate-900'}`}>
          <p className={`font-semibold ${isDark ? 'text-amber-50' : 'text-amber-800'}`}>{activeWithdrawWarning.title}</p>
          <p className={`text-xs mt-1 ${isDark ? 'text-amber-100/90' : 'text-slate-800'}`}>{activeWithdrawWarning.body}</p>
          <label className={`mt-3 flex items-center gap-2 text-xs ${isDark ? 'text-amber-50' : 'text-slate-900'}`}>
            <input
              type="checkbox"
              className={`h-4 w-4 rounded focus:ring-amber-400 ${isDark ? 'border-amber-200 text-amber-200' : 'border-amber-400 text-amber-600'}`}
              checked={withdrawAcknowledged}
              onChange={(event) => setWithdrawAcknowledged(event.target.checked)}
            />
            <span>{activeWithdrawWarning.ack}</span>
          </label>
        </div>
        <Flex
          flexDirection="row"
          justifyContent="center"
          className="gap-3 w-full mt-5"
        >
          <Button
            className={`bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 ${isDark ? 'text-white' : 'text-black'}`}
            onClick={closeWithdrawPrompt}
            disabled={withdrawPromptLoading}
          >
            Cancel
          </Button>
          <Button
            className="bg-red-600 text-white hover:bg-red-500 hover:border-red-500 border-red-600 disabled:opacity-60"
            disabled={!withdrawAcknowledged || withdrawPromptLoading}
            onClick={confirmWithdraw}
          >
            {withdrawPromptLoading ? (
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
            ) : (
              'Withdraw'
            )}
          </Button>
        </Flex>
      </DialogPanel>
    )}
  </Dialog>
  <div className="px-2 sm:px-20 mt-6">
    {/* Tabs + Status on left; compact date filters on right */}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-wrap items-center gap-3">
            <div
              className={`flex items-center gap-1 rounded-full p-1 shadow-sm ${
                isDark
                  ? 'bg-gray-900/40 ring-1 ring-gray-800/60 shadow-black/30'
                  : 'bg-white/90 ring-1 ring-slate-200 shadow-slate-200/80'
              }`}
            >
              {tabOptions.map(({ key, label, icon: Icon }) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setTab(key)}
                    className={`group relative flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide transition-all ${
                      active
                        ? 'bg-red-500/90 text-white shadow-lg shadow-red-500/30'
                        : isDark
                          ? 'text-gray-300 hover:text-white hover:bg-red-500/10'
                          : 'text-slate-700 hover:text-slate-900 hover:bg-red-50'
                    }`}
                  >
                    <Icon className="h-4 w-4 opacity-80" />
                    <span className="whitespace-nowrap">{label}</span>
                    {active && (
                      <span
                        className={`absolute inset-0 rounded-full ring-2 ring-red-400/60 ring-offset-2 ${
                          isDark ? 'ring-offset-gray-950/80' : 'ring-offset-white'
                        }`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-nowrap items-center gap-1 overflow-x-auto pr-1 sm:overflow-visible">
              {statusOptions.map(({ key, label, dotClass }) => {
                const active = status === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setStatus(key)}
                    className={`group relative flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.7rem] font-semibold uppercase tracking-wide transition-all ${
                      active
                        ? 'border-red-500/80 bg-red-500/20 text-red-900 shadow-md shadow-red-500/20 dark:text-white'
                        : isDark
                          ? 'border-gray-700/80 text-gray-300 hover:border-red-400/50 hover:text-white hover:bg-red-500/10'
                          : 'border-slate-300 text-slate-700 hover:border-red-400/60 hover:bg-red-50 hover:text-slate-900'
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                    <span className="whitespace-nowrap">{label}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="sm:hidden ml-2 rounded-full border border-gray-700 px-3 py-1 text-xs text-gray-300 transition hover:border-red-400 hover:text-white"
              onClick={() => setShowFilters(!showFilters)}
            >
              {showFilters ? 'Hide Filters' : 'Filters'}
            </button>
          </div>
          <div className={`${showFilters ? 'flex' : 'hidden'} sm:flex flex-col text-xs gap-1 min-w-0 items-end w-full sm:w-auto`}>
            <label className="text-gray-500">From</label>
            <input type="date" value={dateFrom} onChange={(e)=>setDateFrom(e.target.value)} className="bg-transparent border border-gray-700 rounded px-2 py-1 w-40 sm:w-48" />
            <label className="text-gray-500 mt-2">To</label>
            <input type="date" value={dateTo} onChange={(e)=>setDateTo(e.target.value)} className="bg-transparent border border-gray-700 rounded px-2 py-1 w-40 sm:w-48" />
          </div>
        </div>
        <div className="mt-2 px-2 sm:px-0">
          <select value={sort} onChange={(e)=>setSort(e.target.value as any)} className="bg-transparent border border-gray-700 rounded px-2 py-1">
            <option value="newest">Sort: Newest</option>
            <option value="oldest">Sort: Oldest</option>
          </select>
        </div>

        {/* List */}
        <div className="mt-4 flex flex-col gap-3">
          {tab === 'weekly' ? (
            <>
              {weeklyList.map((item) => (
                <WeeklyCard key={(item as WeeklyRewardView)._id} item={item as WeeklyRewardView} onClaim={handleClaimButton} onBoost={handleBoostButton} />
              ))}
            </>
          ) : (
            <DailyByMonth list={dailyList as DailyRewardView[]} sort={sort} onClaim={handleClaimButton} onBoost={handleBoostButton} />
          )}
          {isLoading && (
            <div className="text-xs text-gray-500">Loading…</div>
          )}
          {list.length === 0 && !isLoading && (
            <div className="text-gray-500 text-sm">No records match the current filters.</div>
          )}
          {!isAllDataLoaded && (
            // Users opt-in to fetching the full history, sidestepping the previous auto-scroll thrash.
            <Button
              className="self-center bg-transparent border border-gray-700 text-slate-900 dark:text-gray-200 hover:bg-red-600 hover:border-red-600 hover:text-white"
              onClick={handleLoadAll}
              disabled={isFetchingNextPage || isLoadingAll}
            >
              {isLoadingAll ? 'Loading All...' : 'Load All History'}
            </Button>
          )}
        </div>
      </div>
      {/* Infinite scroll replaces manual pager */}

      {selReward && (
        <>
          {/* Pass reward source metadata so claim/boost routes to the correct database. */}
          <ClaimModal
            modalName="claim"
            miner_key={selReward.miner_key}
            no={selReward.no}
            reward_db={selReward.reward_db}
            reward_id={selReward.reward_id}
            handleClaim={handleClaim}
          />
          <BoostModal
            modalName="boost"
            miner_key={selReward.miner_key}
            no={selReward.no}
            reward_db={selReward.reward_db}
            reward_id={selReward.reward_id}
            rewardAssetId={selReward.asset_id}
            handleBoost={handleBoost}
          />
        </>
      )}
    </div>
  );
}

// Miner search small component for operators
function MinerSelect() {
  const router = useRouter();
  const current = typeof router.query.miner_key === 'string' ? router.query.miner_key : '';
  const [list, setList] = useState<Array<{ miner_key: string; label: string }>>(current ? [{ miner_key: current, label: current }] : []);
  const [val, setVal] = useState<string>(current);
  const { refresh: refreshFingerprint } = useFingerprintReady();
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetchWithFingerprintRetry(
          () => fetch('/api/devices/list', { method: 'POST' }),
          refreshFingerprint
        );
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        const items = (json?.miner_keys || []) as Array<string | { miner_key: string; nickname?: string | null; productName?: string | null }>;
        const normalized = items
          .map((item) => {
            if (typeof item === 'string') return { miner_key: item, label: item };
            const mk = item?.miner_key;
            if (!mk) return null;
            const nickname = item.nickname || null;
            const productLabel = item.productName || null;
            const label = nickname && nickname.length > 0
              ? `${nickname} (${mk})`
              : productLabel
                ? `${productLabel} (${mk})`
                : mk;
            return { miner_key: mk, label };
          })
          .filter(Boolean) as Array<{ miner_key: string; label: string }>;
        setList(normalized);
        if (!val && normalized.length > 0) setVal(normalized[0].miner_key);
      } catch {}
    };
    run();
    return () => { active = false; };
  }, [refreshFingerprint, val]);
  return (
    // Modernized selector: clearer contrast + padding while keeping native select for accessibility.
    <select
      value={val}
      onChange={(e)=>{ const v = e.target.value; setVal(v); if (v) router.push(`/history?miner_key=${encodeURIComponent(v)}`); }}
      className="w-full rounded-xl border border-slate-300/80 bg-white/80 px-4 py-2 text-sm sm:text-base text-slate-900 shadow-sm shadow-slate-200/60 ring-1 ring-slate-200/70 dark:border-white/10 dark:bg-gray-950/70 dark:text-slate-100 dark:shadow-none"
    >
      {list.length === 0 && <option value="">No devices</option>}
      {list.map((item) => (
        <option key={item.miner_key} value={item.miner_key}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

// Device Health sits above stake history and isolates PoC stats from reward history.
function DeviceHealthSection({
  history,
  loading,
  error,
  isDark
}: {
  history: DeviceHealthHistory | null;
  loading: boolean;
  error: string | null;
  isDark: boolean;
}) {
  // Allow users to switch between local time and UTC for device health timestamps.
  const [timeMode, setTimeMode] = useState<'local' | 'utc'>('local');
  const containerClass = isDark
    ? 'rounded-2xl border border-white/10 bg-black/60 text-gray-100 shadow-xl shadow-black/30'
    : 'rounded-2xl border border-slate-200 bg-white/90 text-slate-900 shadow-sm';
  const labelClass = isDark ? 'text-gray-400' : 'text-slate-600';
  const valueClass = isDark ? 'text-gray-100' : 'text-slate-900';
  const softCardClass = isDark
    ? 'rounded-xl border border-white/10 bg-black/70'
    : 'rounded-xl border border-slate-200 bg-white';

  // Format timestamps based on the selected time mode.
  const formatTime = (value?: string | null) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    if (timeMode === 'utc') {
      return date.toLocaleString(undefined, { timeZone: 'UTC' });
    }
    return date.toLocaleString();
  };

  if (loading) {
    return (
      <div className={containerClass}>
        <div className="px-4 py-4 text-sm">
          <div className={`text-xs uppercase tracking-wide ${labelClass}`}>Device Health</div>
          <div className="mt-2">Loading Device Health history...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={containerClass}>
        <div className="px-4 py-4 text-sm">
          <div className={`text-xs uppercase tracking-wide ${labelClass}`}>Device Health</div>
          <div className="mt-2">{error}</div>
        </div>
      </div>
    );
  }

  if (!history || !history.available) {
    return (
      <div className={containerClass}>
        <div className="px-4 py-4 text-sm">
          <div className={`text-xs uppercase tracking-wide ${labelClass}`}>Device Health</div>
          <div className="mt-2">Device Health data is not available yet for this device.</div>
        </div>
      </div>
    );
  }

  const softwareStatus =
    history.software?.is_uptodate === true
      ? { label: 'Up to date', tone: isDark ? 'text-emerald-300' : 'text-emerald-700' }
      : history.software?.is_uptodate === false
        ? { label: 'Update required', tone: isDark ? 'text-amber-300' : 'text-amber-700' }
        : { label: 'Unknown', tone: labelClass };
  // Proof of Install (POI) is an AEM-only signal.
  const isAemDevice = (history.miner_key ?? '').startsWith('AEM-');
  const poiStatusLabel =
    history.poi_status === true ? 'Detected' : history.poi_status === false ? 'Missing' : 'Unknown';
  const poiStatusTone =
    history.poi_status === true
      ? isDark
        ? 'text-emerald-300'
        : 'text-emerald-700'
      : history.poi_status === false
        ? isDark
          ? 'text-amber-300'
          : 'text-amber-700'
        : labelClass;

  const multiplierHistory = Array.isArray(history.rewards_multiplier_history)
    ? [...history.rewards_multiplier_history].sort((a, b) => b.day.localeCompare(a.day))
    : [];
  const toolsHistory = Array.isArray(history.tools_history)
    ? [...history.tools_history].sort((a, b) => b.day.localeCompare(a.day))
    : [];

  return (
    <div className={containerClass}>
      <div className="px-4 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className={`text-xs uppercase tracking-wide ${labelClass}`}>Device Health</div>
          <div className="flex items-center gap-3">
            {/* Toggle between local time and UTC for timestamp displays. */}
            <div className="inline-flex rounded-full border border-slate-500/30 bg-transparent text-[0.65rem] font-semibold">
              <button
                type="button"
                onClick={() => setTimeMode('local')}
                className={`px-3 py-1 rounded-full ${
                  timeMode === 'local'
                    ? isDark
                      ? 'bg-red-500/20 text-red-100'
                      : 'bg-red-100 text-red-700'
                    : labelClass
                }`}
              >
                Local
              </button>
              <button
                type="button"
                onClick={() => setTimeMode('utc')}
                className={`px-3 py-1 rounded-full ${
                  timeMode === 'utc'
                    ? isDark
                      ? 'bg-red-500/20 text-red-100'
                      : 'bg-red-100 text-red-700'
                    : labelClass
                }`}
              >
                UTC
              </button>
            </div>
            {history.lastUpdated && (
              <div className={`text-[0.65rem] ${labelClass}`}>
                Last updated {formatTime(history.lastUpdated)}
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className={softCardClass}>
            <div className="px-4 py-3 text-sm">
              <div className={`text-xs uppercase tracking-wide ${labelClass}`}>Runtime</div>
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className={labelClass}>Current run started</span>
                  <span className={`font-semibold ${valueClass}`}>
                    {formatTime(history.current_run_started_at)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className={labelClass}>Boot time</span>
                  <span className={`font-semibold ${valueClass}`}>{formatTime(history.boot_time)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className={softCardClass}>
            <div className="px-4 py-3 text-sm">
              <div className={`text-xs uppercase tracking-wide ${labelClass}`}>Software health</div>
              <div className="mt-2 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className={labelClass}>Status</span>
                  <span className={`font-semibold ${softwareStatus.tone}`}>{softwareStatus.label}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className={labelClass}>Software version</span>
                  <span className={`font-semibold ${valueClass}`}>
                    {history.software?.software_version_installed ?? '—'} / {history.software?.software_version_needed ?? '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className={labelClass}>PoC version</span>
                  <span className={`font-semibold ${valueClass}`}>
                    {history.software?.poc_version_installed ?? '—'} / {history.software?.poc_version_needed ?? '—'}
                  </span>
                </div>
                {isAemDevice && (
                  <div className="flex items-center justify-between gap-3">
                    <span className={labelClass}>Proof of install</span>
                    <span className={`font-semibold ${poiStatusTone}`}>{poiStatusLabel}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className={softCardClass}>
            <div className="px-4 py-3 text-sm">
              <div className={`text-xs uppercase tracking-wide ${labelClass}`}>Reward multiplier</div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <span className={labelClass}>Today avg</span>
                <span className={`font-semibold ${valueClass}`}>
                  {typeof history.rewards_multiplier_day === 'number'
                    ? `${history.rewards_multiplier_day.toFixed(2)}x`
                    : '—'}
                </span>
              </div>
              <div className="mt-1 text-[0.7rem] text-gray-500 dark:text-gray-400">
                Slots counted:{' '}
                {typeof history.rewards_multiplier_day_counted_slots === 'number'
                  ? history.rewards_multiplier_day_counted_slots.toLocaleString()
                  : '—'}
              </div>
              <div className="mt-3 space-y-2">
                {multiplierHistory.length === 0 ? (
                  <div className={`text-xs ${labelClass}`}>No multiplier history yet.</div>
                ) : (
                  multiplierHistory.map((entry) => (
                    <div key={entry.day} className="flex items-center justify-between text-xs">
                      <span className={labelClass}>{entry.day}</span>
                      <span className={`font-semibold ${valueClass}`}>
                        {typeof entry.avg === 'number' ? `${entry.avg.toFixed(2)}x` : '—'}
                      </span>
                      <span className={labelClass}>
                        {typeof entry.counted_slots === 'number'
                          ? `${entry.counted_slots.toLocaleString()} slots`
                          : '—'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {toolsHistory.length > 0 && (
            <div className={softCardClass}>
              <div className="px-4 py-3 text-sm">
                <div className={`text-xs uppercase tracking-wide ${labelClass}`}>Tools active (last 24h)</div>
                <div className="mt-2 space-y-2">
                  {toolsHistory.map((entry) => (
                    <div key={entry.day} className="flex items-center justify-between text-xs">
                      <span className={labelClass}>{entry.day}</span>
                      <span className={`font-semibold ${valueClass}`}>
                        {typeof entry.avgToolsCount === 'number'
                          ? `${entry.avgToolsCount.toFixed(2)} / 3`
                          : '—'}
                      </span>
                      <span className={labelClass}>
                        {typeof entry.countedSlots === 'number'
                          ? `${entry.countedSlots.toLocaleString()} slots`
                          : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StakeHistorySection({
  history,
  availability,
  onWithdraw,
  withdrawLoading,
  isDark
}: {
  history: StakeHistoryMap | null;
  availability: StakeAvailabilityMap;
  onWithdraw: (type: StakeCategory) => void;
  withdrawLoading: Partial<Record<StakeCategory, boolean>>;
  isDark: boolean;
}) {
  const sections: Array<{ key: keyof StakeHistoryMap; label: string; entries: StakeEvent[] }> = [
    { key: 'verification', label: 'Verification Stake History', entries: history?.verification ?? [] },
    { key: 'registration', label: 'Registration Stake History', entries: history?.registration ?? [] },
    { key: 'node', label: 'Node Operation Stake History', entries: history?.node ?? [] }
  ];

  const hasHistory = sections.some((section) => section.entries.length > 0);

  const formatDateTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  };

  const formatAmount = (amount: number) => amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatTx = (txId: string) => (txId.length <= 12 ? txId : `${txId.slice(0, 6)}…${txId.slice(-4)}`);

  const formatCountdown = (target: Date) => {
    const diffMs = target.getTime() - Date.now();
    if (diffMs <= 0) return 'unlocking now';
    const days = Math.floor(diffMs / dayMs);
    const hours = Math.floor((diffMs % dayMs) / (60 * 60 * 1000));
    const minutes = Math.floor((diffMs % (60 * 60 * 1000)) / (60 * 1000));
    if (days > 0) return `${days} day${days === 1 ? '' : 's'} remaining`;
    if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} remaining`;
    return `${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
  };

  const activeEntries = (['verification', 'registration', 'node'] as StakeCategory[]).map((type) => ({
    type,
    ...(availability?.[type] ?? { hasStake: false, available: false })
  }));
  const hasActiveEntries = activeEntries.some((entry) => entry.hasStake);

  if (!hasHistory && !hasActiveEntries) {
    return null;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Stake Activity</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Track every stake and withdrawal for this device across verification, registration, and node operation.
        </p>
      </div>
      {hasActiveEntries && (
        <div className="grid gap-3 md:grid-cols-3">
          {activeEntries
            .filter((entry) => entry.hasStake)
            .map((entry) => {
              const notice = STAKE_WITHDRAW_WARNINGS[entry.type];
              return (
                <div
                  key={entry.type}
                  className={`rounded-lg border p-4 shadow-sm flex flex-col gap-2 ${
                    isDark
                      ? 'border-gray-800 bg-gray-900/40 text-white shadow-inner shadow-black/20'
                      : 'border-slate-200 bg-white text-slate-900'
                  }`}
                >
                  <div className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
                    Active {STAKE_LABELS[entry.type]}
                  </div>
                  <div className="text-2xl font-semibold">
                    {entry.amount ? entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                  </div>
                  <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
                    {entry.assetId ? getAssetDisplay(entry.assetId) : 'Asset unknown'}
                  </div>
                  {entry.type === 'verification' && entry.lockType && (
                    <div className={`text-xs ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>
                      Lock: {entry.lockType === 'two' ? 'Type 2 (6 month)' : 'Type 1 (24 hour)'}
                    </div>
                  )}
                  {entry.available ? (
                    <p className={`text-xs ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                      {entry.type === 'verification' ? 'Lock complete. Ready to withdraw.' : 'Ready to withdraw.'}
                    </p>
                  ) : entry.type === 'verification' && entry.availableAt ? (
                    <p className={`text-xs ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>
                      Unlocks on {entry.availableAt.toLocaleString()} ({formatCountdown(entry.availableAt)})
                    </p>
                  ) : entry.type === 'verification' ? (
                    <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>Waiting for lock completion.</p>
                  ) : null}
                  {notice && (
                    <div className={`rounded border px-3 py-2 text-[0.7rem] ${
                      isDark
                        ? 'border-amber-400/40 bg-amber-500/10 text-amber-100'
                        : 'border-amber-200 bg-amber-50 text-amber-900'
                    }`}>
                      <p className={`font-semibold ${isDark ? 'text-amber-50' : 'text-amber-800'}`}>{notice.title}</p>
                      <p className="text-xs mt-1">{notice.body}</p>
                    </div>
                  )}
                  <Button
                    className={`mt-auto bg-transparent hover:bg-red-600 hover:border-red-600 disabled:opacity-40 ${
                      entry.available
                        ? 'border-red-600 text-red-600 hover:text-white dark:text-red-200'
                        : 'border-slate-300 dark:border-gray-700 text-slate-400 cursor-not-allowed'
                    }`}
                    disabled={!entry.available || withdrawLoading[entry.type]}
                    onClick={() => onWithdraw(entry.type)}
                  >
                    {withdrawLoading[entry.type] ? 'Withdrawing…' : 'Withdraw'}
                  </Button>
                </div>
              );
            })}
        </div>
      )}
      {sections.map((section) => {
        if (section.entries.length === 0) return null;
        return (
          <div
            key={section.key}
            className={`rounded-lg border p-4 ${
              isDark
                ? 'border-gray-800 bg-black/40 text-gray-100 shadow-inner shadow-black/20'
                : 'border-slate-200 bg-white text-slate-900 shadow-sm'
            }`}
          >
            <h3 className={`mb-3 text-sm font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-slate-600'}`}>{section.label}</h3>
            <div className="overflow-x-auto text-xs">
              <table className={`min-w-full divide-y ${isDark ? 'divide-gray-800' : 'divide-slate-200'}`}>
                <thead>
                  <tr className={`text-left text-[0.7rem] uppercase tracking-wide ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>
                    <th className="py-2 pr-4">Action</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Asset</th>
                    <th className="py-2 pr-4">Lock Type</th>
                    <th className="py-2 pr-4">Transaction</th>
                    <th className="py-2 pr-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-gray-900/60 text-gray-300' : 'divide-slate-200 text-slate-800'}`}>
                  {section.entries.map((event, idx) => (
                    <tr key={`${event.txId}-${idx}`}>
                      <td className="py-2 pr-4 font-semibold">
                        {event.action === 'staked' ? (
                          <span className={isDark ? 'text-emerald-300' : 'text-emerald-700'}>Staked</span>
                        ) : (
                          <span className={isDark ? 'text-amber-300' : 'text-amber-700'}>Withdrawn</span>
                        )}
                      </td>
                      <td className="py-2 pr-4">{formatAmount(event.amount)}</td>
                      <td className="py-2 pr-4 font-mono text-[0.65rem]">{event.assetId ?? '—'}</td>
                      <td className="py-2 pr-4">
                        {event.lockType
                          ? event.lockType === 'two'
                            ? 'Type 2 (6 month)'
                            : 'Type 1 (24 hour)'
                          : '—'}
                      </td>
                      <td className="py-2 pr-4 font-mono text-[0.65rem]">
                        {event.txId ? (
                          <a
                            href={`https://explorer.perawallet.app/tx/${event.txId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={isDark ? 'text-sky-400 hover:text-sky-300' : 'text-sky-700 hover:text-sky-600'}
                          >
                            {formatTx(event.txId)}
                          </a>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="py-2 pr-4">{formatDateTime(event.time)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Daily grouped by month with collapsible sections
function DailyByMonth({ list, onClaim, onBoost, sort }: { list: DailyRewardView[]; onClaim: (r:any)=>void; onBoost: (r:any)=>void; sort: 'newest' | 'oldest'; }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const m = new Map<string, DailyRewardView[]>();
    for (const it of list) {
      const d = new Date(it.createdAt);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    return Array.from(m.entries()).sort((a,b)=> sort === 'oldest' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]));
  }, [list, sort]);
  useEffect(()=>{
    // expand latest month by default
    if (groups.length>0) setExpanded((e)=> ({...e, [groups[0][0]]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length]);
  return (
    <div className="flex flex-col gap-3">
      {groups.map(([month, items]) => (
        <div key={month} className="border border-gray-800 rounded-lg">
          <div
            className="flex items-center justify-between px-3 py-2 cursor-pointer select-none"
            role="button"
            tabIndex={0}
            onClick={()=> setExpanded((e)=> ({...e, [month]: !e[month]}))}
            onKeyDown={(ev)=> { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setExpanded((e)=> ({...e, [month]: !e[month]})); } }}
          >
            <div className="text-sm text-white font-semibold">{month}</div>
            <button
              className="text-xs px-2 py-1 border border-gray-700 rounded"
              onClick={(ev)=> { ev.stopPropagation(); setExpanded((e)=> ({...e, [month]: !e[month]})); }}
            >
              {expanded[month] ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {expanded[month] && (
            <div className="p-3 flex flex-col gap-3">
              {items.map(it => (
                <DailyRow key={it._id} item={it} onClaim={onClaim} onBoost={onBoost} />
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


const EMPTY_HISTORY_PROPS = {
  props: { initialRewards: [], initialTotalPages: 0, initialCounts: { weekly: 0, daily: 0 } }
};

export async function getServerSideProps(context: GetServerSidePropsContext) {
  // Avoid internal fetch to NEXTAUTH_URL_INTERNAL; read session from cookies directly.
  const session = await getServerSession(context.req, context.res, authOptions);
  if (!session?.user) {
    return EMPTY_HISTORY_PROPS;
  }

  const minerKeyParam = context?.query?.miner_key;
  const miner_key = Array.isArray(minerKeyParam) ? minerKeyParam[0] : minerKeyParam;
  if (!miner_key) {
    return EMPTY_HISTORY_PROPS;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    // Rewards are split post-cutoff; load the dbrewards client for SSR.
    const rewardsClient = await rewardsClientPromise;
    const rewardsDb = rewardsClient.db('dbrewards');
    // Weekly cutoff still gates weekly vs daily classification (distinct from DB split cutoff).
    const cutoffIso = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
    const cutoffDate = new Date(cutoffIso);

    // Load reward docs from both databases and merge by cutoff for SSR.
    const [mainDoc, newDoc] = await Promise.all([
      db.collection(resolveRewardsCollectionName('main', testMode)).findOne({ miner_key }),
      rewardsDb.collection(resolveRewardsCollectionName('dbrewards', testMode)).findOne({ miner_key })
    ]);
    if (!mainDoc && !newDoc) {
      return EMPTY_HISTORY_PROPS;
    }
    const docs: Array<{ source: RewardsDbSource; doc: any | null }> = [
      { source: 'main', doc: mainDoc },
      { source: 'dbrewards', doc: newDoc }
    ];

    const daysBetween = (a: Date, b: Date): number => {
      const ms = Math.max(0, b.getTime() - a.getTime());
      return Math.min(30, Math.max(0, Math.floor(ms / dayMs)));
    };

    const formatRange = (start: Date, end: Date): string => {
      const fmt = (d: Date) =>
        d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
      return `${fmt(start)} – ${fmt(end)}`;
    };

    const weekly = docs.flatMap(({ source, doc }) =>
      (doc?.weekly_rewards || [])
        .filter((wr: any) => {
          const rewardDate = getWeeklyRewardDate(wr);
          if (!wr?.unlock_at || !rewardDate) {
            return false;
          }
          const inDbSplit = source === 'main'
            ? isBeforeRewardsCutoff(rewardDate)
            : isOnOrAfterRewardsCutoff(rewardDate);
          // Weekly cutoff remains in effect for weekly records.
          return inDbSplit && rewardDate >= cutoffDate;
        })
        .map((wr: any) => {
          const unlockAt = new Date(wr.unlock_at);
          return {
            _id: wr._id,
            miner_key,
            no: wr.reward_number,
            status: wr.status,
            asset_id: wr.asset_id,
            amount: wr.amount,
            txId: wr.tx_id,
            createdAt: wr.unlock_at,
            claimedAt: wr.claimed_at,
            isWeekly: true,
            progressDays: daysBetween(unlockAt, new Date()),
            etaDate: new Date(unlockAt.getTime() + 30 * dayMs),
            weekLabel: (() => {
              const wkStart = wr.week_start
                ? new Date(wr.week_start)
                : new Date(getThisFridayStartUTC(unlockAt).getTime() - 7 * dayMs);
              const wkEnd = wr.week_end ? new Date(wr.week_end) : new Date(wkStart.getTime() + 6 * dayMs);
              return formatRange(wkStart, wkEnd);
            })(),
            // Include source metadata so claim/boost can route correctly.
            reward_db: source,
            reward_id: wr?._id ? String(wr._id) : undefined
          };
        })
    );

    const daily = docs.flatMap(({ source, doc }) =>
      (doc?.daily_rewards || [])
        .filter((dr: any) => {
          const rewardDate = getDailyRewardDate(dr);
          // dbrewards does not store daily rewards; keep daily strictly in main pre-cutoff.
          if (source !== 'main') return false;
          const inDbSplit = isBeforeRewardsCutoff(rewardDate);
          return inDbSplit && rewardDate !== null && rewardDate < cutoffDate;
        })
        .map((dr: any) => {
          const createdAt = new Date(dr.created_at ?? dr.date);
          return {
            _id: dr._id,
            miner_key,
            no: dr.reward_number,
            status: dr.status,
            asset_id: dr.asset_id,
            amount: dr.amount,
            txId: dr.tx_id,
            // Preserve date fallback when created_at is missing in legacy records.
            createdAt: dr.created_at ?? dr.date,
            claimedAt: dr.claimed_at,
            isWeekly: false,
            progressDays: daysBetween(createdAt, new Date()),
            etaDate: new Date(createdAt.getTime() + 30 * dayMs),
            // Include source metadata so claim/boost can route correctly.
            reward_db: source,
            reward_id: dr?._id ? String(dr._id) : undefined
          };
        })
    );

    const allRewards = weekly
      .concat(daily)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const totalRewards = allRewards.length;
    const totalPages = totalRewards > 0 ? Math.ceil(totalRewards / PAGE_SIZE) : 0;

    const recentCutoff = new Date();
    recentCutoff.setMonth(recentCutoff.getMonth() - 3);
    const recentRewards = allRewards.filter((reward: any) => {
      const ts = new Date(reward.createdAt).getTime();
      return !Number.isNaN(ts) && ts >= recentCutoff.getTime();
    });

    const initialRewards = recentRewards.length > 0 ? recentRewards : allRewards.slice(0, PAGE_SIZE);

    return {
      props: {
        initialRewards: JSON.parse(JSON.stringify(initialRewards)),
        initialTotalPages: totalPages,
        initialCounts: { weekly: weekly.length, daily: daily.length }
      }
    };
  } catch (error) {
    console.error('Failed to load reward history', error);
  }

  return EMPTY_HISTORY_PROPS;
}
