import { Button, Flex, Title } from '@tremor/react';
import { CalendarIcon, ClockIcon } from '@heroicons/react/outline';
import Image from 'next/image';
import type { GetServerSidePropsContext } from 'next';
import bgImg from '../assets/background.png';
import { getSession, useSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { Reward } from '../lib/types';
import { useRewardSummary } from '../lib/hooks/useRewardSummary';
import WeeklyCard, { WeeklyRewardView } from '../components/WeeklyCard';
import DailyRow, { DailyRewardView } from '../components/DailyRow';
import Link from 'next/link';
import { type ElementType, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
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
import { REWARD_STATUS_DESCRIPTIONS, getAssetDisplay } from '../lib/utils';
import { isLegacyVerificationStake } from '../lib/legacyStake';
import { useToastContext } from '../hooks/ToastContext';
import { secureFetch } from '../lib/api/secureFetch';
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

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

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

const STAKE_LABELS: Record<StakeCategory, string> = {
  verification: 'Verification Stake',
  registration: 'Registration Stake',
  node: 'Node Operation Stake'
};

// Smart price formatting component with hover tooltip
const TokenPricesBar = () => {
  const [prices, setPrices] = useState<{ fry2?: number; fnode?: number }>({});

  useEffect(() => {
    let active = true;
    const fetchPrices = async () => {
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
      } catch (error) {
        console.error('Failed to fetch prices', error);
      }
    };
    fetchPrices();
    const interval = setInterval(fetchPrices, 300000); // 5 minutes
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, []);

  const formatPrice = (price: number): { display: string; full: string } => {
    const full = `$${price.toFixed(10).replace(/\.?0+$/, '')}`;
    
    if (price >= 1) {
      return { display: `$${price.toFixed(2)}`, full };
    } else if (price >= 0.01) {
      // Show 4 decimals for values between $0.01 and $1
      const trimmed = price.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      return { display: `$${trimmed}`, full };
    } else if (price >= 0.0001) {
      const trimmed = price.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
      return { display: `$${trimmed}`, full };
    } else if (price > 0) {
      return { display: `$${price.toExponential(1)}`, full };
    }
    return { display: '$0.00', full: '$0.00' };
  };

  const PriceWithTooltip = ({ label, price }: { label: string; price: number }) => {
    const formatted = formatPrice(price);
    return (
      <span className="group relative inline-block">
        <span className="font-bold text-white">
          {label}: {formatted.display}
        </span>
        {formatted.display !== formatted.full && (
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white shadow-lg z-50">
            {formatted.full}
          </span>
        )}
      </span>
    );
  };

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs sm:text-sm px-2">
      <PriceWithTooltip label="FRY 2.0" price={prices.fry2 || 0} />
      <span className="text-white text-gray-400">•</span>
      <PriceWithTooltip label="fNode" price={prices.fnode || 0} />
      <span className="text-white text-gray-400">•</span>
      <a
        href="https://vote.frynetworks.com/allvotes"
        target="_blank"
        rel="noreferrer"
        className="font-bold text-white underline hover:text-gray-200 whitespace-nowrap"
      >
        About FIP-009 (Switch from daily to weekly rewards)
      </a>
    </div>
  );
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
  const [deviceRefreshToken, setDeviceRefreshToken] = useState(0);
  const hasStakeHistory = useMemo(() => {
    if (!stakeHistoryData) return false;
    return (
      stakeHistoryData.verification.length > 0 ||
      stakeHistoryData.registration.length > 0 ||
      stakeHistoryData.node.length > 0
    );
  }, [stakeHistoryData]);


  const { miner_key } = router.query;
  const minerKey = typeof miner_key === 'string' ? miner_key : undefined;
  const isTFryMiner = useMemo(() => {
    if (!minerKey) return false;
    const prefix = minerKey.split('-')[0] || '';
    if (!prefix) return false;
    if (NODE_PREFIXES.has(prefix) || prefix === AEM_PREFIX) return false;
    return true;
  }, [minerKey]);
  const { data: summary, mutate: mutateSummary } = useRewardSummary(minerKey);
  const [now, setNow] = useState(() => Date.now());
  const { ready: fingerprintReady, refresh: refreshFingerprint } = useFingerprintReady();
  const isLoadingAllRef = useRef(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);

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

  const StatusPill = ({
    label,
    value,
    colorClass,
    tooltip
  }: {
    label: string;
    value: unknown;
    colorClass: string;
    tooltip?: string;
  }) => {
    const pill = (
      <span
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.7rem] font-semibold ${colorClass}`}
      >
        <span className="uppercase tracking-wide text-[0.68rem]">{label}</span>
        <span className="text-white text-sm font-semibold tracking-normal normal-case">
          {formatSummaryValue(value)}
        </span>
      </span>
    );

    if (!tooltip) {
      return pill;
    }

    return <Tooltip text={tooltip}>{pill}</Tooltip>;
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
    [fingerprintReady, minerKey, refreshFingerprint]
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
        if (!res.ok) return;
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
  }, [miner_key, session?.user?.address, refreshFingerprint, deviceRefreshToken]);

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

  const handleWithdrawStake = useCallback(
    async (type: StakeCategory) => {
      if (!session?.user?.address || typeof miner_key !== 'string') {
        toast.error({
          heading: 'Withdraw Error',
          message: 'Select a device and ensure you are signed in before withdrawing.'
        });
        return;
      }

      const endpointMap: Record<StakeCategory, string> = {
        verification: '/api/stake/stake-withdraw',
        registration: '/api/stake/r-withdraw',
        node: '/api/stake/n-withdraw'
      };

      if (type === 'verification') {
        const confirmMessage = 'Withdrawing your verification stake removes your multiplier and you will only earn base rewards until you re-stake with FRY 2.0. Do you want to continue?';
        const confirmed = typeof window === 'undefined' ? false : window.confirm(confirmMessage);
        if (!confirmed) {
          return;
        }
      }

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
          return;
        }

        toast.success({
          heading: 'Withdraw submitted',
          message: payload?.txId ? `Tx: ${payload.txId}` : 'Withdrawal completed.'
        });
        setDeviceRefreshToken((token) => token + 1);
      } catch (error) {
        console.error('[history] withdraw failed', error);
        toast.error({
          heading: 'Withdraw Error',
          message: 'Unable to submit withdrawal. Please try again.'
        });
      } finally {
        setWithdrawLoading((prev) => ({ ...prev, [type]: false }));
      }
    },
    [miner_key, session?.user?.address, toast]
  );


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
    <div className="w-full">
      <div className="relative flex">
        <Image
          src={bgImg}
          className="w-full h-32 sm:h-36 object-cover"
          alt="Background Image"
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-3"
        >
          <Title className="text-white text-2xl sm:text-3xl lg:text-4xl font-extralight tracking-wide px-2">
            Reward History
          </Title>
          <p className="text-sm sm:text-base text-center px-2 text-gray-300">
            You can explore the rewards history and manage each reward for
            miners and nodes.
          </p>
          <TokenPricesBar />
        </Flex>
      </div>
      <div className="px-2 sm:px-20">
        <Link href="/devices">
          <Button className="mt-6 min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600">
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
    <div className="px-2 sm:px-20 mt-3 text-gray-300">
      <div className="text-white text-lg sm:text-xl font-semibold">
        {deviceMeta.nickname || deviceMeta.name || '-'}
        {typeof miner_key === 'string' && (
              <span className="text-gray-400 font-normal"> {' '}({miner_key})</span>
            )}
          </div>
          {deviceMeta.productName && (
            <div className="text-sm mt-1">
              Product: <span className="text-white">{deviceMeta.productName}</span>
            </div>
          )}
    </div>
  )}
  <div className="px-2 sm:px-20 mt-4 text-white border-b border-white/10 py-3">
    {summary && (
      <>
      <div className="flex flex-wrap gap-2">
        <StatusPill
          label="Accruing (weekly preview)"
          value={summary.accruing ?? 0}
          colorClass="border-sky-500/60 bg-sky-500/15 text-sky-200"
          tooltip={REWARD_STATUS_DESCRIPTIONS.accruing}
        />
        <StatusPill
          label="Pending"
          value={summary.pending ?? 0}
          colorClass="border-amber-500/60 bg-amber-500/15 text-amber-200"
          tooltip={REWARD_STATUS_DESCRIPTIONS.pending}
        />
        <StatusPill
          label="Claimable"
          value={summary.claimable ?? 0}
          colorClass="border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
          tooltip={REWARD_STATUS_DESCRIPTIONS.claimable}
        />
        {typeof summary.claimed === 'number' && (
          <StatusPill
            label="Claimed"
            value={summary.claimed}
            colorClass="border-gray-600 bg-gray-800 text-gray-300"
          />
        )}
      </div>
      {isTFryMiner && typeof summary.legacyFryClaimedSnapshot === 'number' && (
        <div className="mt-4 rounded-2xl border border-yellow-400/40 bg-yellow-500/10 p-4">
          <div className="text-xs uppercase tracking-wide text-yellow-200/80 font-semibold">
            Legacy Fry 1.0 Claimed - 12/13/2024 to 10/08/2025
          </div>
          <div className="mt-1 text-2xl font-semibold text-yellow-100">
            {formatLegacyAmount(summary.legacyFryClaimedSnapshot)} FRY 1.0
          </div>
          <p className="mt-1 text-xs text-yellow-200/80">
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
  {(hasStakeHistory || Object.values(stakeAvailability).some((entry) => entry.hasStake)) && (
    <div className="px-2 sm:px-20 mt-6">
      <StakeHistorySection
        history={stakeHistoryData}
        availability={stakeAvailability}
        onWithdraw={handleWithdrawStake}
        withdrawLoading={withdrawLoading}
      />
    </div>
  )}
  <div className="px-2 sm:px-20 mt-6">
    {/* Tabs + Status on left; compact date filters on right */}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1 rounded-full bg-gray-900/40 p-1 shadow-sm shadow-black/30 ring-1 ring-gray-800/60">
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
                        : 'text-gray-400 hover:text-white hover:bg-red-500/10'
                    }`}
                  >
                    <Icon className="h-4 w-4 opacity-80" />
                    <span className="whitespace-nowrap">{label}</span>
                    {active && <span className="absolute inset-0 rounded-full ring-2 ring-red-400/60 ring-offset-2 ring-offset-gray-950/80" />}
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
                        ? 'border-red-500/80 bg-red-500/20 text-white shadow-md shadow-red-500/30'
                        : 'border-gray-700/80 text-gray-400 hover:border-red-400/50 hover:text-white hover:bg-red-500/10'
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
              className="self-center bg-transparent border border-gray-700 hover:bg-red-600 hover:border-red-600 hover:text-white"
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
          <ClaimModal
            modalName="claim"
            miner_key={selReward.miner_key}
            no={selReward.no}
            handleClaim={handleClaim}
          />
          <BoostModal
            modalName="boost"
            miner_key={selReward.miner_key}
            no={selReward.no}
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
  const [list, setList] = useState<string[]>(current ? [current] : []);
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
        const keys: string[] = json?.miner_keys || [];
        setList(keys);
        if (!val && keys.length > 0) setVal(keys[0]);
      } catch {}
    };
    run();
    return () => { active = false; };
  }, [refreshFingerprint, val]);
  return (
    <select
      value={val}
      onChange={(e)=>{ const v = e.target.value; setVal(v); if (v) router.push(`/history?miner_key=${encodeURIComponent(v)}`); }}
      className="w-full bg-transparent border border-gray-700 rounded px-3 py-2 text-sm sm:text-base"
    >
      {list.length === 0 && <option value="">No devices</option>}
      {list.map(k => (
        <option key={k} value={k}>{k}</option>
      ))}
    </select>
  );
}

function StakeHistorySection({
  history,
  availability,
  onWithdraw,
  withdrawLoading
}: {
  history: StakeHistoryMap | null;
  availability: StakeAvailabilityMap;
  onWithdraw: (type: StakeCategory) => void;
  withdrawLoading: Partial<Record<StakeCategory, boolean>>;
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
        <h2 className="text-lg font-semibold text-white">Stake Activity</h2>
        <p className="mt-1 text-sm text-gray-400">
          Track every stake and withdrawal for this device across verification, registration, and node operation.
        </p>
      </div>
      {hasActiveEntries && (
        <div className="grid gap-3 md:grid-cols-3">
          {activeEntries
            .filter((entry) => entry.hasStake)
            .map((entry) => (
              <div
                key={entry.type}
                className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 shadow-inner shadow-black/20 flex flex-col gap-2"
              >
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Active {STAKE_LABELS[entry.type]}
                </div>
                <div className="text-2xl font-semibold text-white">
                  {entry.amount ? entry.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                </div>
                <div className="text-xs text-gray-400">
                  {entry.assetId ? getAssetDisplay(entry.assetId) : 'Asset unknown'}
                </div>
                {entry.type === 'verification' && entry.lockType && (
                  <div className="text-xs text-gray-500">
                    Lock: {entry.lockType === 'two' ? 'Type 2 (6 month)' : 'Type 1 (24 hour)'}
                  </div>
                )}
                {entry.available ? (
                  <p className="text-xs text-emerald-300">Lock complete. Ready to withdraw.</p>
                ) : entry.availableAt ? (
                  <p className="text-xs text-gray-400">
                    Unlocks on {entry.availableAt.toLocaleString()} ({formatCountdown(entry.availableAt)})
                  </p>
                ) : (
                  <p className="text-xs text-gray-500">Waiting for lock completion.</p>
                )}
                {entry.type === 'verification' && (
                  <div className="rounded border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-[0.7rem] text-amber-100">
                    Withdrawing removes your verification multiplier. You will earn base rewards until you re-stake with FRY&nbsp;2.0.
                  </div>
                )}
                <Button
                  className="mt-auto bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 disabled:opacity-40"
                  disabled={!entry.available || withdrawLoading[entry.type]}
                  onClick={() => onWithdraw(entry.type)}
                >
                  {withdrawLoading[entry.type] ? 'Withdrawing…' : 'Withdraw'}
                </Button>
              </div>
            ))}
        </div>
      )}
      {sections.map((section) => {
        if (section.entries.length === 0) return null;
        return (
          <div key={section.key} className="rounded-lg border border-gray-800 bg-black/40 p-4 shadow-inner shadow-black/20">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">{section.label}</h3>
            <div className="overflow-x-auto text-xs">
              <table className="min-w-full divide-y divide-gray-800">
                <thead>
                  <tr className="text-left text-[0.7rem] uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-4">Action</th>
                    <th className="py-2 pr-4">Amount</th>
                    <th className="py-2 pr-4">Asset</th>
                    <th className="py-2 pr-4">Lock Type</th>
                    <th className="py-2 pr-4">Transaction</th>
                    <th className="py-2 pr-4">Timestamp</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-900/60 text-gray-300">
                  {section.entries.map((event, idx) => (
                    <tr key={`${event.txId}-${idx}`}>
                      <td className="py-2 pr-4 font-semibold">
                        {event.action === 'staked' ? (
                          <span className="text-emerald-300">Staked</span>
                        ) : (
                          <span className="text-amber-300">Withdrawn</span>
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
                            className="text-sky-400 hover:text-sky-300"
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
  const session = await getSession(context);
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
    const cutoffIso = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
    const cutoffDate = new Date(cutoffIso);

    const doc = await db.collection('device-rewards').findOne({ miner_key });
    if (!doc) {
      return EMPTY_HISTORY_PROPS;
    }

    const daysBetween = (a: Date, b: Date): number => {
      const ms = Math.max(0, b.getTime() - a.getTime());
      return Math.min(30, Math.max(0, Math.floor(ms / dayMs)));
    };

    const formatRange = (start: Date, end: Date): string => {
      const fmt = (d: Date) =>
        d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
      return `${fmt(start)} – ${fmt(end)}`;
    };

    const weekly = (doc?.weekly_rewards || [])
      .filter((wr: any) => wr.unlock_at && new Date(wr.unlock_at) >= cutoffDate)
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
          })()
        };
      });

    const daily = (doc?.daily_rewards || [])
      .filter((dr: any) => dr.created_at && new Date(dr.created_at) < cutoffDate)
      .map((dr: any) => {
        const createdAt = new Date(dr.created_at);
        return {
          _id: dr._id,
          miner_key,
          no: dr.reward_number,
          status: dr.status,
          asset_id: dr.asset_id,
          amount: dr.amount,
          txId: dr.tx_id,
          createdAt: dr.created_at,
          claimedAt: dr.claimed_at,
          isWeekly: false,
          progressDays: daysBetween(createdAt, new Date()),
          etaDate: new Date(createdAt.getTime() + 30 * dayMs)
        };
      });

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
