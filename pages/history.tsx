import PageShell from "../components/PageShell";
import { Button, Flex, Title, Dialog, DialogPanel } from '@tremor/react';
import { CalendarIcon, ClockIcon } from '@heroicons/react/outline';
import type { GetServerSidePropsContext } from 'next';
import bgImg from '../assets/background.png';
import HeroBanner from '../components/HeroBanner';
import { signOut, useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet-react';
import { getServerSession } from 'next-auth';
import { authOptions } from './api/auth/[...nextauth]';
import clientPromise from '../lib/mongoclient';
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
import { collectStakeHistory, type StakeEvent, type StakeHistoryMap } from '../lib/history/collectStakeHistory';
import Tooltip from '../components/Tooltip';
import StatusPill from '../components/StatusPill';
import { REWARD_STATUS_DESCRIPTIONS, getAssetDisplay } from '../lib/utils';
import { isLegacyVerificationStake } from '../lib/legacyStake';
import { useToastContext } from '../hooks/ToastContext';
import { secureFetch } from '../lib/api/secureFetch';
import { getServerTime, getServerTimestamp, setServerTime } from "../lib/serverTime";
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider'; // Holiday-aware hero
// removed asset filter; keep utils unused import out

const FIVE_MINUTES = 5 * 60 * 1000;
function getThisFridayStartUTC(ref: Date): Date {
  const utc = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));
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
const testMode = process.env.NEXT_PUBLIC_TEST_MODE && process.env.NEXT_PUBLIC_TEST_MODE === 'true';
const NODE_PREFIXES = new Set(['RDN', 'SVN', 'SDN', 'CN']);
const AEM_PREFIX = 'AEM';
const FEM_PREFIX = 'FEM';
const PAGE_SIZE = 10;
const dayMs = 24 * 60 * 60 * 1000;
const sixMonthsMs = 180 * dayMs;
const devModeClient = process.env.NEXT_PUBLIC_DEV_MODE && process.env.NEXT_PUBLIC_DEV_MODE === 'true';
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
const STAKE_WITHDRAW_WARNINGS: Record<StakeCategory, {
  title: string;
  body: string;
  ack: string;
}> = {
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
  initialCounts?: {
    weekly: number;
    daily: number;
  };
}) {
  type RewardView = WeeklyRewardView | DailyRewardView;
  // Cache initial SSR payload once so CSR can build on top of it without round-tripping.
  const prefetchedRewards = initialRewards as unknown as RewardView[];
  const hasPrefetched = Array.isArray(prefetchedRewards) && prefetchedRewards.length > 0;
  const prefetchedPageCount = hasPrefetched ? Math.max(1, Math.ceil(prefetchedRewards.length / PAGE_SIZE)) : 0;
  const initialPage = hasPrefetched ? prefetchedPageCount : 0;
  const initialTotal = initialTotalPages || (hasPrefetched ? prefetchedPageCount : 0);
  const initialWeeklyLoaded = prefetchedRewards.filter(r => (r as any).isWeekly === true).length;
  const initialDailyLoaded = prefetchedRewards.length - initialWeeklyLoaded;

  // Stateful paging data the UI renders, seeded from the SSR results above.
  const [rewards, setRewards] = useState<RewardView[]>(prefetchedRewards);
  const [totalPages, setTotalPages] = useState(initialTotal);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [selReward, setSelReward] = useState<Reward | undefined>(undefined);
  const {
    openModal
  } = useModal();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingNextPage, setIsFetchingNextPage] = useState(false); // Guards the "Load more" button against double clicks.
  const currentPageRef = useRef(initialPage); // Keeps loadPage stable without re-defining the callback.
  const totalPagesRef = useRef(initialTotal);
  const [totalCounts, setTotalCounts] = useState<{
    weekly: number;
    daily: number;
  }>(() => ({
    weekly: initialCounts?.weekly ?? initialWeeklyLoaded,
    daily: initialCounts?.daily ?? initialDailyLoaded
  }));
  const [showFilters, setShowFilters] = useState(false);
  const [prices, setPrices] = useState<{
    fry2?: number;
    fnode?: number;
  }>({});
  const {
    data: session
  } = useSession();
  const { activeAccount } = useWallet();
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
    return stakeHistoryData.verification.length > 0 || stakeHistoryData.registration.length > 0 || stakeHistoryData.node.length > 0;
  }, [stakeHistoryData]);

  // Align hero palette with other pages by matching the current theme.
  const {
    resolvedTheme
  } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const {
    activeHoliday
  } = useSeasonalTheme();
  const holidayKey = activeHoliday?.key ?? null;
  const heroOffsetClass = holidayKey === 'christmas' ? 'mt-10 sm:mt-14' : 'mt-2'; // Xmas: push hero down to clear garland

  const {
    miner_key
  } = router.query;
  const minerKey = typeof miner_key === 'string' ? miner_key : undefined;
  const isTFryMiner = useMemo(() => {
    if (!minerKey) return false;
    const prefix = minerKey.split('-')[0] || '';
    if (!prefix) return false;
    if (NODE_PREFIXES.has(prefix) || prefix === AEM_PREFIX || prefix === FEM_PREFIX) return false;
    return true;
  }, [minerKey]);
  const {
    data: summary,
    mutate: mutateSummary
  } = useRewardSummary(minerKey);
  const [now, setNow] = useState(() => getServerTime());
  const {
    ready: fingerprintReady,
    refresh: refreshFingerprint
  } = useFingerprintReady();
  const isLoadingAllRef = useRef(false);
  const [isLoadingAll, setIsLoadingAll] = useState(false);
  const activeWithdrawWarning = withdrawPrompt ? STAKE_WITHDRAW_WARNINGS[withdrawPrompt] : null;
  const handleSecurityBlock = useCallback((code?: string) => {
    if (securityToastShown.current) return;
    securityToastShown.current = true;
    const message = code === 'DEVICE_MISMATCH' ? 'Our system detected a security issue and signed you out to protect your account. Please reconnect with your device wallet to continue.' : 'Security verification failed. Please reconnect with your device wallet to continue.';
    setSecurityBlocked(true);
    setSecurityMessage(message);
    toast.error({
      heading: 'Security check triggered',
      message
    });
    void signOut({
      redirect: true,
      callbackUrl: '/signin'
    });
  }, [toast]);

  // Mirror reactive state into refs so loadPage can stay memoised without re-running parent effects.
  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);
  useEffect(() => {
    totalPagesRef.current = totalPages;
  }, [totalPages]);
  useEffect(() => {
    const interval = setInterval(() => setNow(getServerTime()), 60_000);
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
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
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
    const hours = Math.floor(totalMinutes % (60 * 24) / 60);
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
  const fetchRewardsPage = useCallback(async (targetPage: number): Promise<RewardsPageResult> => {
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
      const response = await fetchWithFingerprintRetry(async () => {
        const body = {
          miner_key: minerKey,
          page: targetPage
        };
        const timestamp = getServerTimestamp();
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
      }, refreshFingerprint, {
        refreshClientToken: refreshClientTokenOnce
      });
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
      if (result.serverTime) setServerTime(result.serverTime);
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
  }, [fingerprintReady, minerKey, refreshFingerprint, handleSecurityBlock]);
  const applyPageData = useCallback((result: Exclude<RewardsPageResult, null>, targetPage: number, replace: boolean): boolean => {
    const {
      items,
      weeklyCount,
      dailyCount,
      totalCount,
      totalPages: totalPagesHint
    } = result;
    setTotalCounts(prev => ({
      weekly: typeof weeklyCount === 'number' ? weeklyCount : prev.weekly,
      daily: typeof dailyCount === 'number' ? dailyCount : prev.daily
    }));
    setRewards(prev => {
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
      setCurrentPage(prev => prev > fallback ? fallback : prev);
    }
    return hasItems;
  }, []);

  // Unified loader powering initial fetches and manual page advances.
  const loadPage = useCallback(async (targetPage: number, options: {
    replace?: boolean;
  } = {}) => {
    if (!minerKey) return;
    const {
      replace = false
    } = options;
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
  }, [minerKey, fetchRewardsPage, applyPageData]);
  const handleClaimButton = (reward: Reward) => {
    console.log('Claim Button');
    setSelReward(reward);
    openModal('claim');
  };
  const claimQueueRef = useRef<any[]>([]);
  const isClaimingAllRef = useRef(false);

  const handleClaimAll = () => {
    const queue = [...itemsWeekly, ...itemsDaily].filter((r: any) => r.status === 'claimable' && !r.onHold);
    if (queue.length === 0) return;
    isClaimingAllRef.current = true;
    claimQueueRef.current = queue.slice(1) as any;
    setSelReward(queue[0] as unknown as Reward);
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
    setTotalCounts({
      weekly: 0,
      daily: 0
    });
    await loadPage(1, {
      replace: true
    });
    if (mutateSummary) await mutateSummary();

    if (isClaimingAllRef.current) {
      if (!ret) {
        isClaimingAllRef.current = false;
        claimQueueRef.current = [];
        toast.error({ heading: 'Claim All stopped', message: message || 'A claim failed. Please try again.' });
        return;
      }
      if (claimQueueRef.current.length > 0) {
        const next = claimQueueRef.current.shift();
        if (next) {
          setSelReward(next as unknown as Reward);
          openModal('claim');
        }
      } else {
        isClaimingAllRef.current = false;
        toast.success({ heading: 'All claimed', message: 'All rewards have been claimed successfully.' });
      }
    }
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
    setTotalCounts({
      weekly: 0,
      daily: 0
    });
    await loadPage(1, {
      replace: true
    });
    if (mutateSummary) await mutateSummary();
  };

  // Reset and fetch on miner_key change (use SSR payload if present)
  useEffect(() => {
    const rewardViews = initialRewards as unknown as RewardView[];
    const prefetched = Array.isArray(rewardViews) && rewardViews.length > 0;
    const prefetchedPages = prefetched ? Math.max(1, Math.ceil(rewardViews.length / PAGE_SIZE)) : 0;
    const pageValue = prefetched ? prefetchedPages : 0;
    const totalValue = initialTotalPages || (prefetched ? prefetchedPages : 0);
    const weeklyLoaded = prefetched ? rewardViews.filter(r => (r as any).isWeekly === true).length : 0;
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
      loadPage(1, {
        replace: true
      });
    }
  }, [fingerprintReady, minerKey, initialRewards, initialTotalPages, initialCounts, loadPage]);

  // Fetch live prices for header context
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch('/api/price/get', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            asset_ids: ['2485314946', '2485202024']
          })
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
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  // Device identity (nickname/name and product name)
  const [deviceMeta, setDeviceMeta] = useState<{
    nickname?: string;
    name?: string;
    productName?: string;
  } | null>(null);
  useEffect(() => {
    if (typeof miner_key !== 'string' || miner_key.length === 0 || !session?.user?.address) {
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
        const res = await fetchWithFingerprintRetry(() => fetch(`/api/devices/${miner_key}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: session.user.address
          })
        }), refreshFingerprint);
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
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              miner_key
            })
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
        setDeviceMeta({
          nickname: nick,
          name,
          productName
        });
      } catch {}
    })();
    return () => {
      active = false;
    };
  }, [miner_key, session?.user?.address, refreshFingerprint, deviceRefreshToken, handleSecurityBlock]);

  // (moved) Infinite scroll observer defined after derived lists for type safety

  // Derived tabs and filters
  const [tab, setTab] = useState<'weekly' | 'daily'>('weekly');
  const [status, setStatus] = useState<'all' | 'pending' | 'claimable' | 'claimed'>('all');
  // Declarative tab metadata keeps the button rendering tidy and ensures icon + label stay in sync.
  const tabOptions: Array<{
    key: 'weekly' | 'daily';
    label: string;
    icon: ElementType;
  }> = [{
    key: 'weekly',
    label: 'Weekly',
    icon: CalendarIcon
  }, {
    key: 'daily',
    label: 'Legacy Daily',
    icon: ClockIcon
  }];
  // Status filters share the same rendering path; define them here with their color cues.
  const statusOptions: Array<{
    key: 'all' | 'pending' | 'claimable' | 'claimed';
    label: string;
    dotClass: string;
  }> = [{
    key: 'all',
    label: 'All',
    dotClass: 'bg-gray-400'
  }, {
    key: 'pending',
    label: 'Pending',
    dotClass: 'bg-warning-400'
  }, {
    key: 'claimable',
    label: 'Claimable',
    dotClass: 'bg-emerald-400'
  }, {
    key: 'claimed',
    label: 'Claimed',
    dotClass: 'bg-sky-400'
  }];
  // Removed asset filter; using miner dropdown instead
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [searchText, setSearchText] = useState('');
  const itemsWeekly: WeeklyRewardView[] = (rewards || []).filter((r): r is WeeklyRewardView => (r as any).isWeekly === true);
  const itemsDaily: DailyRewardView[] = (rewards || []).filter((r): r is DailyRewardView => (r as any).isWeekly !== true);
  // const allAssets = Array.from(new Set((rewards || []).map((r) => r.asset_id))).filter((id) => id);

  const stakeAvailability = useMemo<StakeAvailabilityMap>(() => {
    const defaultEntry = {
      hasStake: false,
      available: false
    };
    const map: StakeAvailabilityMap = {
      verification: {
        ...defaultEntry
      },
      registration: {
        ...defaultEntry
      },
      node: {
        ...defaultEntry
      }
    };
    const parseAmount = (value: any): number | undefined => {
      if (typeof value === 'number' && Number.isFinite(value)) return value;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const setEntry = (type: StakeCategory, info: Partial<StakeAvailability>) => {
      map[type] = {
        ...map[type],
        ...info,
        hasStake: true
      };
    };
    const verification = activeStakes?.verification;
    if (verification) {
      const amount = parseAmount(verification.amount);
      const stakeTime = verification.time ? new Date(verification.time).getTime() : NaN;
      if (amount && amount > 0 && Number.isFinite(stakeTime)) {
        const lockType = verification.type === 'two' ? 'two' : 'one';
        const unlockAt = lockType === 'two' ? new Date(stakeTime + sixMonthsMs) : new Date(stakeTime + dayMs);
        const productStakeAsset = productTokens?.stake;
        const assetId = verification.asset_id ? String(verification.asset_id) : undefined;
        const assetMismatch = assetId && productStakeAsset ? String(assetId) !== String(productStakeAsset) : false;
        const available = devModeClient || legacyStakeUnlocked || assetMismatch || getServerTime() >= unlockAt.getTime();
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
  const submitWithdraw = useCallback(async (type: StakeCategory): Promise<boolean> => {
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
    setWithdrawLoading(prev => ({
      ...prev,
      [type]: true
    }));
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
      setDeviceRefreshToken(token => token + 1);
      return true;
    } catch (error) {
      console.error('[history] withdraw failed', error);
      toast.error({
        heading: 'Withdraw Error',
        message: 'Unable to submit withdrawal. Please try again.'
      });
      return false;
    } finally {
      setWithdrawLoading(prev => ({
        ...prev,
        [type]: false
      }));
    }
  }, [miner_key, session?.user?.address, toast]);
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
  const applyFilters = <T extends RewardView,>(list: T[]) => {
    const fromTs = dateFrom ? new Date(dateFrom + 'T00:00:00Z').getTime() : undefined;
    const toTs = dateTo ? new Date(dateTo + 'T23:59:59Z').getTime() : undefined;
    const q = searchText.trim().toLowerCase();
    return list.filter(r => {
      if (status !== 'all' && r.status !== status) return false;
      const ts = new Date(r.createdAt as any).getTime();
      if (fromTs && ts < fromTs) return false;
      if (toTs && ts > toTs) return false;
      if (q) {
        const haystack = `${r.miner_key} ${r.status} ${(r as any).weekLabel || ''}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  };
  const applySort = <T extends RewardView,>(list: T[]): T[] => {
    if (sort === 'oldest') {
      return [...list].sort((a: any, b: any) => new Date(a.createdAt as any).getTime() - new Date(b.createdAt as any).getTime()) as T[];
    }
    // newest
    return [...list].sort((a: any, b: any) => new Date(b.createdAt as any).getTime() - new Date(a.createdAt as any).getTime()) as T[];
  };
  const weeklyFiltered = applyFilters(itemsWeekly);
  const dailyFiltered = applyFilters(itemsDaily);
  const weeklyList = applySort(weeklyFiltered);
  const dailyList = applySort(dailyFiltered);
  const list = tab === 'weekly' ? weeklyList : dailyList;

  // Removed asset filter defaulting

  // Matures soon count (<=3 days left) only for weekly pending
  const maturesSoon = useMemo(() => {
    const now = getServerTime();
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    return itemsWeekly.filter(w => w.status === 'pending' && new Date(w.etaDate).getTime() - now <= threeDaysMs).length;
  }, [itemsWeekly]);
  const loadedWeekly = useMemo(() => rewards.filter(r => (r as any).isWeekly === true).length, [rewards]);
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
  if (activeAccount && !session) {
    return (
      <PageShell title="Reward History" breadcrumb={true}>
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="text-center">
            <p className="text-ink font-body font-semibold mb-2">Session expired</p>
            <p className="text-ink-secondary font-body text-sm mb-4">Your wallet is connected, but your dashboard session has expired.</p>
            <Link href="/signin" className="text-primary-500 hover:text-primary-400 font-medium">Sign in again →</Link>
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Transaction History" breadcrumb={true}>
      <div className="space-y-8">
        {securityBlocked && (
          <div className="rounded-token-lg border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm text-warning-500">
            <strong>Security check triggered.</strong>{' '}
            {securityMessage ?? 'Please reconnect with your device wallet to continue.'}
          </div>
        )}

        {deviceMeta && (
          <div className="text-ink">
            <div className="text-lg sm:text-xl font-semibold text-ink">
              {deviceMeta.nickname || deviceMeta.name || '-'}
              {typeof miner_key === 'string' && (
                <span className="text-ink-secondary font-normal"> ({miner_key})</span>
              )}
            </div>
            {deviceMeta.productName && (
              <div className="text-sm mt-1 text-ink-secondary">
                Product: <span className="font-semibold text-ink">{deviceMeta.productName}</span>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-3 text-sm">
              <Link href="https://byod.frynetworks.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-primary-500 hover:text-primary-400 font-medium transition">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" /></svg>
                BYOD →
              </Link>
              <span className="text-divider">|</span>
              <a href="https://explorer.frynetworks.com" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-ink-secondary hover:text-ink transition">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                View on Explorer →
              </a>
            </div>
          </div>
        )}

        {/* Claim model: rewards are claimable on-demand from the dashboard */}
        <div className="rounded-token-md border border-success-500/30 bg-success-500/10 px-4 py-3 text-sm text-ink">
          <strong className="text-success-500">Claimable rewards:</strong>{' '}
          Rewards are claimable from your dashboard once earned — use the Claim button on each device to receive them in your wallet.
        </div>
        {summary && (
          <div className="border-b border-divider pb-4">
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-token-sm px-2 py-1 text-xs font-medium bg-info-500/15 text-info-400">
                Accruing {formatSummaryValue(summary.accruing ?? 0)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-token-sm px-2 py-1 text-xs font-medium bg-warning-500/15 text-warning-400">
                Pending {formatSummaryValue(summary.pending ?? 0)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-token-sm px-2 py-1 text-xs font-medium bg-success-500/15 text-success-400">
                Claimable {formatSummaryValue(summary.claimable ?? 0)}
              </span>
              {typeof summary.claimed === 'number' && (
                <span className="inline-flex items-center gap-1.5 rounded-token-sm px-2 py-1 text-xs font-medium bg-surface-strong text-ink-secondary">
                  Claimed {formatSummaryValue(summary.claimed)}
                </span>
              )}
            </div>
            {isTFryMiner && typeof summary.legacyFryClaimedSnapshot === 'number' && (
              <div className="mt-4 rounded-token-lg border border-warning-500/30 bg-warning-500/10 p-4">
                <div className="text-xs uppercase tracking-wide font-semibold text-warning-500">
                  Legacy Fry 1.0 Claimed - 12/13/2024 to 10/08/2025
                </div>
                <div className="mt-1 text-2xl font-semibold text-ink">
                  {formatLegacyAmount(summary.legacyFryClaimedSnapshot)} FRY 1.0
                </div>
                <p className="mt-1 text-xs text-warning-500">
                  Historical FRY 1.0 payouts claimed before the tFry migration. These are shown for context only and are not included in the tFry totals above.
                </p>
              </div>
            )}
          </div>
        )}

        <Link
          href="/convert"
          className="group flex items-center gap-4 bg-surface-elevated border border-divider rounded-token-lg p-space-4 hover:border-primary-500 hover:shadow-token-md transition"
        >
          <div className="w-8 h-8 shrink-0 rounded-token-md bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-primary-500">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} className="w-4 h-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm text-ink">Token Conversion</div>
            <div className="text-xs text-ink-secondary">Convert FRY 1.0 to FRY 2.0 or tFRY</div>
          </div>
          <div className="text-sm font-medium text-primary-500 group-hover:underline shrink-0">Convert →</div>
        </Link>

        {hasLegacyVerificationStake && (
          <div className="rounded-token-lg border border-warning-500/30 bg-warning-500/10 px-4 py-4">
            <div className="text-xs uppercase tracking-[0.35em] text-warning-500">Legacy FRY 1.0 stake detected</div>
            <p className="mt-2 text-sm text-warning-500">
              Legacy FRY 1.0 verification stake detected. Withdraw the legacy stake and re-stake with FRY 2.0 to keep multiplier rewards.
            </p>
          </div>
        )}

        {(hasStakeHistory || Object.values(stakeAvailability).some(entry => entry.hasStake)) && (
          <details className="rounded-token-lg border border-divider bg-surface-elevated group">
            <summary className="cursor-pointer list-none flex items-center justify-between px-4 py-3 text-sm font-medium text-ink hover:bg-surface-strong/50 transition rounded-token-lg">
              <span className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 text-ink-secondary">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Stake History
              </span>
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4 transition-transform group-open:rotate-180 text-ink-secondary">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </summary>
            <div className="px-4 pb-4">
              <StakeHistorySection
                history={stakeHistoryData}
                availability={stakeAvailability}
                onWithdraw={handleWithdrawRequest}
                withdrawLoading={withdrawLoading}
                isDark={isDark}
              />
            </div>
          </details>
        )}

        {withdrawPrompt && activeWithdrawWarning && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className={`w-full max-w-xl rounded-token-xl border border-divider p-6 shadow-token-lg ${isDark ? 'bg-surface-elevated text-ink' : 'bg-white text-ink'}`}>
              <h3 className="text-lg font-semibold mb-4">Withdraw {STAKE_LABELS[withdrawPrompt]}</h3>
              <div className="rounded-token-lg border border-warning-500/30 bg-warning-500/10 px-4 py-3 text-sm">
                <p className="font-semibold text-warning-500">{activeWithdrawWarning.title}</p>
                <p className="text-xs mt-1 text-warning-500">{activeWithdrawWarning.body}</p>
                <label className="mt-3 flex items-center gap-2 text-xs text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-divider text-primary-500 focus:ring-primary-500"
                    checked={withdrawAcknowledged}
                    onChange={event => setWithdrawAcknowledged(event.target.checked)}
                  />
                  <span>{activeWithdrawWarning.ack}</span>
                </label>
              </div>
              <div className="flex flex-row justify-center gap-3 w-full mt-5">
                <button
                  className="rounded-token-md border border-error-500 px-4 py-2 text-sm font-semibold transition hover:bg-error-500 hover:text-white text-error-500 disabled:opacity-60"
                  onClick={closeWithdrawPrompt}
                  disabled={withdrawPromptLoading}
                >
                  Cancel
                </button>
                <button
                  className="rounded-token-md bg-error-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-error-400 disabled:opacity-60"
                  disabled={!withdrawAcknowledged || withdrawPromptLoading}
                  onClick={confirmWithdraw}
                >
                  {withdrawPromptLoading ? (
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  ) : 'Withdraw'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Rewards layout */}
        <div className="space-y-6">
          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row gap-space-3 mb-space-6 items-center justify-between">
            <div className="w-full sm:w-1/3">
              <input
                type="text"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                placeholder="Search rewards..."
                className="bg-surface-strong border border-divider rounded-token-lg px-4 py-2 w-full text-sm text-ink placeholder:text-ink-secondary outline-none focus:ring-2 focus:ring-primary-500/40 transition"
              />
            </div>

            <div className="w-full sm:w-auto">
              <MinerSelect />
            </div>

            {(() => {
              const claimableItems = [...itemsWeekly, ...itemsDaily].filter((r: any) => r.status === 'claimable');
              const claimableCount = claimableItems.length;
              const totalClaimable = claimableItems.reduce((sum, r: any) => sum + (typeof r.amount === 'number' ? r.amount : 0), 0);
              return claimableCount > 0 ? (
                <button
                  onClick={handleClaimAll}
                  className="bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded-token-md font-semibold text-sm transition"
                >
                  Claim All Rewards ({totalClaimable.toFixed(2)})
                </button>
              ) : null;
            })()}
          </div>

          {/* Tabs */}
          <div className="flex flex-wrap gap-2 mb-space-4">
            {tabOptions.map(({ key, label, icon: Icon }) => {
              const active = tab === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setTab(key)}
                  className={`flex items-center gap-2 rounded-token-md px-3 py-1.5 text-sm font-medium transition ${
                    active
                      ? 'bg-primary-500/15 text-primary-500 border border-primary-500/60'
                      : 'bg-surface-strong text-ink-secondary border border-divider hover:text-ink'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Status filters */}
          <div className="flex flex-wrap gap-2 mb-space-4">
            {statusOptions.map(({ key, label, dotClass }) => {
              const active = status === key;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatus(key)}
                  className={`flex items-center gap-1.5 rounded-token-sm px-3 py-1 text-xs font-medium transition ${
                    active
                      ? 'bg-primary-500 text-white'
                      : 'bg-surface-strong text-ink-secondary border border-divider hover:text-ink'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Desktop list */}
          <div className="hidden md:block space-y-2">
            <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] text-xs text-ink-secondary uppercase tracking-wider font-display border-b border-divider pb-2 px-4">
              <div>Device</div>
              <div>Token</div>
              <div>Amount</div>
              <div>Status</div>
              <div>Date</div>
              <div>Action</div>
            </div>
            {list.map((item, i) => {
              const isClaimable = item.status === 'claimable';
              const isWeekly = (item as any).isWeekly === true;
              let statusClass = 'bg-surface-strong text-ink-muted';
              if (item.status === 'claimable') statusClass = 'bg-success-500/20 text-success-400';
              if (item.status === 'pending') statusClass = 'bg-warning-500/20 text-warning-400';
              return (
                <div
                  key={(item as any)._id || i}
                  className="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] bg-surface-elevated border border-divider rounded-token-md px-4 py-3 mb-2 hover:border-primary-500/30 transition items-center"
                >
                  <div className="text-sm text-ink truncate pr-2">{item.miner_key}</div>
                  <div className="text-sm text-ink-secondary">{getAssetDisplay(item.asset_id)}</div>
                  <div className="text-sm font-display text-ink">{item.amount}</div>
                  <div>
                    <span className={`inline-flex items-center gap-1.5 rounded-token-sm px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                      {item.status === 'claimable' && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
                      {item.status}
                    </span>
                  </div>
                  <div className="text-xs text-ink-muted">{new Date(item.createdAt as any).toLocaleDateString()}</div>
                  <div className="flex items-center gap-2">
                    {isClaimable && (
                      <button
                        onClick={() => handleClaimButton(item as unknown as Reward)}
                        className="bg-primary-500 text-white px-3 py-1 rounded-token-sm text-sm font-medium transition hover:bg-primary-600"
                      >
                        Claim
                      </button>
                    )}
                    {isWeekly && (
                      <button
                        onClick={() => handleBoostButton(item as unknown as Reward)}
                        className="text-xs text-accent-500 hover:text-accent-400 font-medium transition"
                      >
                        Boost
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Mobile list */}
          <div className="md:hidden space-y-3">
            {list.map((item, i) => {
              const isClaimable = item.status === 'claimable';
              let statusClass = 'bg-surface-strong text-ink-muted';
              if (item.status === 'claimable') statusClass = 'bg-success-500/20 text-success-400';
              if (item.status === 'pending') statusClass = 'bg-warning-500/20 text-warning-400';
              return (
                <div
                  key={(item as any)._id || i}
                  className="bg-surface-elevated border border-divider rounded-token-lg p-space-4"
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold text-sm text-ink">{getAssetDisplay(item.asset_id)}</span>
                    <span className={`inline-flex items-center gap-1.5 rounded-token-sm px-2 py-0.5 text-xs font-medium ${statusClass}`}>
                      {item.status === 'claimable' && <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />}
                      {item.status}
                    </span>
                  </div>
                  <div className="text-lg font-display text-primary-500 mb-1">{item.amount}</div>
                  <div className="text-xs text-ink-muted mb-1">{item.miner_key}</div>
                  <div className="text-xs text-ink-muted mb-3">{new Date(item.createdAt as any).toLocaleDateString()}</div>
                  {isClaimable && (
                    <button
                      onClick={() => handleClaimButton(item as unknown as Reward)}
                      className="w-full bg-primary-500 text-white py-2 rounded-token-md text-sm font-medium transition hover:bg-primary-600"
                    >
                      Claim
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Empty state */}
          {list.length === 0 && !isLoading && (
            <div className="text-center py-12">
              <div className="w-12 h-12 mx-auto mb-4 text-ink-secondary">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 6h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold text-ink mb-1">No reward history yet</h3>
              <p className="text-sm text-ink-secondary mb-4">Register a device to start earning.</p>
              <Link href="/register" className="inline-flex items-center gap-2 text-sm font-semibold text-primary-500 hover:underline">
                Register Device →
              </Link>
            </div>
          )}

          {isLoading && <div className="text-xs text-ink-secondary">Loading…</div>}

          {!isAllDataLoaded && list.length > 0 && (
            <div className="flex justify-center pt-2">
              <Button
                className="bg-transparent border border-divider text-ink hover:bg-primary-500 hover:border-primary-500 hover:text-white"
                onClick={handleLoadAll}
                disabled={isFetchingNextPage || isLoadingAll}
              >
                {isLoadingAll ? 'Loading All...' : 'Load All History'}
              </Button>
            </div>
          )}
        </div>

        {selReward && (
          <>
            <ClaimModal modalName="claim" miner_key={selReward.miner_key} no={selReward.no} handleClaim={handleClaim} />
            <BoostModal modalName="boost" miner_key={selReward.miner_key} no={selReward.no} rewardAssetId={(selReward as any)?.asset_id} handleBoost={handleBoost} />
          </>
        )}
      </div>
    </PageShell>
  );
}


// Miner search small component for operators
function MinerSelect() {
  const router = useRouter();
  const current = typeof router.query.miner_key === 'string' ? router.query.miner_key : '';
  const [list, setList] = useState<Array<{
    miner_key: string;
    label: string;
  }>>(current ? [{
    miner_key: current,
    label: current
  }] : []);
  const [val, setVal] = useState<string>(current);
  const {
    refresh: refreshFingerprint
  } = useFingerprintReady();
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetchWithFingerprintRetry(() => fetch('/api/devices/list', {
          method: 'POST'
        }), refreshFingerprint);
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        const items = (json?.miner_keys || []) as Array<string | {
          miner_key: string;
          nickname?: string | null;
          productName?: string | null;
          status?: string | null;
        }>;
        const normalized = items.map(item => {
          if (typeof item === 'string') return {
            miner_key: item,
            label: item
          };
          const mk = item?.miner_key;
          if (!mk) return null;
          const nickname = item.nickname || null;
          const productLabel = item.productName || null;
          const status = item.status || null;
          const baseLabel = nickname && nickname.length > 0 ? `${nickname} (${mk})` : productLabel ? `${productLabel} (${mk})` : mk;
          const label = status ? `${baseLabel} (${status})` : baseLabel;
          return {
            miner_key: mk,
            label
          };
        }).filter(Boolean) as Array<{
          miner_key: string;
          label: string;
        }>;
        setList(normalized);
        if (!val && normalized.length > 0) setVal(normalized[0].miner_key);
      } catch {}
    };
    run();
    return () => {
      active = false;
    };
  }, [refreshFingerprint, val]);
  return (
    // Modernized selector: clearer contrast + padding while keeping native select for accessibility.
    <select value={val} onChange={e => {
      const v = e.target.value;
      setVal(v);
      if (v) router.push(`/history?miner_key=${encodeURIComponent(v)}`);
    }} className="w-full rounded-token-lg border border-slate-300/80 bg-white/80 px-4 py-2 text-sm sm:text-base text-ink shadow-token-sm shadow-slate-200/60 ring-1 ring-slate-200/70 dark:border-divider dark:bg-surface/70 dark:text-slate-100 dark:shadow-none">
      {list.length === 0 && <option value="">No devices</option>}
      {list.map(item => <option key={item.miner_key} value={item.miner_key}>
          {item.label}
        </option>)}
    </select>
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
  const [isExpanded, setIsExpanded] = useState(false);
  const sections: Array<{
    key: keyof StakeHistoryMap;
    label: string;
    entries: StakeEvent[];
  }> = [{
    key: 'verification',
    label: 'Verification Stake History',
    entries: history?.verification ?? []
  }, {
    key: 'registration',
    label: 'Registration Stake History',
    entries: history?.registration ?? []
  }, {
    key: 'node',
    label: 'Node Operation Stake History',
    entries: history?.node ?? []
  }];
  const hasHistory = sections.some(section => section.entries.length > 0);
  const formatDateTime = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString();
  };
  const formatAmount = (amount: number) => amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  const formatTx = (txId: string) => txId.length <= 12 ? txId : `${txId.slice(0, 6)}…${txId.slice(-4)}`;
  const formatCountdown = (target: Date) => {
    const diffMs = target.getTime() - getServerTime();
    if (diffMs <= 0) return 'unlocking now';
    const days = Math.floor(diffMs / dayMs);
    const hours = Math.floor(diffMs % dayMs / (60 * 60 * 1000));
    const minutes = Math.floor(diffMs % (60 * 60 * 1000) / (60 * 1000));
    if (days > 0) return `${days} day${days === 1 ? '' : 's'} remaining`;
    if (hours > 0) return `${hours} hour${hours === 1 ? '' : 's'} remaining`;
    return `${minutes} minute${minutes === 1 ? '' : 's'} remaining`;
  };
  const activeEntries = (['verification', 'registration', 'node'] as StakeCategory[]).map(type => ({
    type,
    ...(availability?.[type] ?? {
      hasStake: false,
      available: false
    })
  }));
  const hasActiveEntries = activeEntries.some(entry => entry.hasStake);
  if (!hasHistory && !hasActiveEntries) {
    return null;
  }
  const activeCount = activeEntries.filter(entry => entry.hasStake).length;
  return (
    <div className={`rounded-token-md border overflow-hidden ${isDark ? 'border-gray-800 bg-black/40 text-gray-100' : 'border-divider bg-surface-elevated text-ink'}`}>
      <button
        type="button"
        onClick={() => setIsExpanded(prev => !prev)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left transition ${isDark ? 'hover:bg-gray-800/50' : 'hover:bg-slate-50'}`}
        aria-expanded={isExpanded}
      >
        <div>
          <h2 className="text-sm font-semibold text-ink">Stake Activity</h2>
          <p className="text-xs text-ink-muted mt-0.5">
            {activeCount} active stake{activeCount === 1 ? '' : 's'}
          </p>
        </div>
        <span className="text-ink-muted text-xs">
          {isExpanded ? 'Collapse' : 'Expand'}
        </span>
      </button>
      {isExpanded && (
        <div className="px-4 pb-4 space-y-6">
          <div>
            <p className="text-sm text-gray-600 dark:text-ink-muted">
              Track every stake and withdrawal for this device across verification, registration, and node operation.
            </p>
          </div>
          {hasActiveEntries && <div className="grid gap-3 md:grid-cols-3">
              {activeEntries.filter(entry => entry.hasStake).map(entry => {
            const notice = STAKE_WITHDRAW_WARNINGS[entry.type];
            return <div key={entry.type} className={`rounded-token-md border p-4 shadow-token-sm flex flex-col gap-2 ${isDark ? 'border-gray-800 bg-surface-strong/40 text-ink shadow-inner shadow-black/20' : 'border-divider bg-surface-elevated text-ink'}`}>
                      <div className={`text-xs font-semibold uppercase tracking-wide ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
                        Active {STAKE_LABELS[entry.type]}
                      </div>
                      <div className="text-2xl font-semibold">
                        {entry.amount ? entry.amount.toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                }) : '0.00'}
                      </div>
                      <div className={`text-xs ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
                        {entry.assetId ? getAssetDisplay(entry.assetId) : 'Asset unknown'}
                      </div>
                      {entry.type === 'verification' && entry.lockType && <div className={`text-xs ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
                          Lock: {entry.lockType === 'two' ? 'Type 2 (6 month)' : 'Type 1 (24 hour)'}
                        </div>}
                      {entry.available ? <p className={`text-xs ${isDark ? 'text-emerald-300' : 'text-emerald-700'}`}>
                          {entry.type === 'verification' ? 'Lock complete. Ready to withdraw.' : 'Ready to withdraw.'}
                        </p> : entry.type === 'verification' && entry.availableAt ? <p className={`text-xs ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
                          Unlocks on {entry.availableAt.toLocaleString()} ({formatCountdown(entry.availableAt)})
                        </p> : entry.type === 'verification' ? <p className={`text-xs ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>Waiting for lock completion.</p> : null}
                      {notice && <div className={`rounded border px-3 py-2 text-[0.7rem] ${isDark ? 'border-warning-400/40 bg-warning-500/10 text-warning-100' : 'border-warning-200 bg-warning-50 text-warning-900'}`}>
                          <p className={`font-semibold ${isDark ? 'text-warning-50' : 'text-warning-800'}`}>{notice.title}</p>
                          <p className="text-xs mt-1">{notice.body}</p>
                        </div>}
                      <Button className={`mt-auto bg-transparent hover:bg-primary-500 hover:border-error-500 disabled:opacity-40 ${entry.available ? 'border-error-500 text-error-500 hover:text-ink dark:text-primary-200' : 'border-slate-300 dark:border-gray-700 text-slate-400 cursor-not-allowed'}`} disabled={!entry.available || withdrawLoading[entry.type]} onClick={() => onWithdraw(entry.type)}>
                        {withdrawLoading[entry.type] ? 'Withdrawing…' : 'Withdraw'}
                      </Button>
                    </div>;
          })}
            </div>}
          {sections.map(section => {
          if (section.entries.length === 0) return null;
          return <div key={section.key} className={`rounded-token-md border p-4 ${isDark ? 'border-gray-800 bg-black/40 text-gray-100 shadow-inner shadow-black/20' : 'border-divider bg-surface-elevated text-ink shadow-token-sm'}`}>
                <h3 className={`mb-3 text-sm font-semibold uppercase tracking-wide ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>{section.label}</h3>
                <div className="overflow-x-auto text-xs">
                  <table className={`min-w-full divide-y ${isDark ? 'divide-gray-800' : 'divide-slate-200'}`}>
                    <thead>
                      <tr className={`text-left text-[0.7rem] uppercase tracking-wide ${isDark ? 'text-ink-muted' : 'text-ink-muted'}`}>
                        <th className="py-2 pr-4">Action</th>
                        <th className="py-2 pr-4">Amount</th>
                        <th className="py-2 pr-4">Asset</th>
                        <th className="py-2 pr-4">Lock Type</th>
                        <th className="py-2 pr-4">Transaction</th>
                        <th className="py-2 pr-4">Timestamp</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-gray-900/60 text-ink-secondary' : 'divide-slate-200 text-slate-800'}`}>
                      {section.entries.map((event, idx) => <tr key={`${event.txId}-${idx}`}>
                          <td className="py-2 pr-4 font-semibold">
                            {event.action === 'staked' ? <span className={isDark ? 'text-emerald-300' : 'text-emerald-700'}>Staked</span> : <span className={isDark ? 'text-warning-300' : 'text-warning-700'}>Withdrawn</span>}
                          </td>
                          <td className="py-2 pr-4">{formatAmount(event.amount)}</td>
                          <td className="py-2 pr-4 font-mono text-[0.65rem]">{event.assetId ?? '—'}</td>
                          <td className="py-2 pr-4">
                            {event.lockType ? event.lockType === 'two' ? 'Type 2 (6 month)' : 'Type 1 (24 hour)' : '—'}
                          </td>
                          <td className="py-2 pr-4 font-mono text-[0.65rem]">
                            {event.txId ? <a href={`https://explorer.perawallet.app/tx/${event.txId}`} target="_blank" rel="noopener noreferrer" className={isDark ? 'text-sky-400 hover:text-sky-300' : 'text-sky-700 hover:text-sky-600'}>
                                {formatTx(event.txId)}
                              </a> : '—'}
                          </td>
                          <td className="py-2 pr-4">{formatDateTime(event.time)}</td>
                        </tr>)}
                    </tbody>
                  </table>
                </div>
              </div>;
        })}
        </div>
      )}
    </div>
  );
}

// Daily grouped by month with collapsible sections
function DailyByMonth({
  list,
  onClaim,
  onBoost,
  sort
}: {
  list: DailyRewardView[];
  onClaim: (r: any) => void;
  onBoost: (r: any) => void;
  sort: 'newest' | 'oldest';
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const m = new Map<string, DailyRewardView[]>();
    for (const it of list) {
      const d = new Date(it.createdAt);
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(it);
    }
    return Array.from(m.entries()).sort((a, b) => sort === 'oldest' ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0]));
  }, [list, sort]);
  useEffect(() => {
    // expand latest month by default
    if (groups.length > 0) setExpanded(e => ({
      ...e,
      [groups[0][0]]: true
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length]);
  return <div className="flex flex-col gap-3">
      {groups.map(([month, items]) => <div key={month} className="border border-gray-800 rounded-token-md">
          <div className="flex items-center justify-between px-3 py-2 cursor-pointer select-none" role="button" tabIndex={0} onClick={() => setExpanded(e => ({
        ...e,
        [month]: !e[month]
      }))} onKeyDown={ev => {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          setExpanded(e => ({
            ...e,
            [month]: !e[month]
          }));
        }
      }}>
            <div className="text-sm text-ink font-semibold">{month}</div>
            <button className="text-xs px-2 py-1 border border-gray-700 rounded" onClick={ev => {
          ev.stopPropagation();
          setExpanded(e => ({
            ...e,
            [month]: !e[month]
          }));
        }}>
              {expanded[month] ? 'Collapse' : 'Expand'}
            </button>
          </div>
          {expanded[month] && <div className="p-3 flex flex-col gap-3">
              {items.map(it => <DailyRow key={it._id} item={it} onClaim={onClaim} onBoost={onBoost} />)}
            </div>}
        </div>)}
    </div>;
}
const EMPTY_HISTORY_PROPS = {
  props: {
    initialRewards: [],
    initialTotalPages: 0,
    initialCounts: {
      weekly: 0,
      daily: 0
    }
  }
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
    const cutoffIso = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
    const cutoffDate = new Date(cutoffIso);
    const doc = await db.collection('device-rewards').findOne({
      miner_key
    });
    if (!doc) {
      return EMPTY_HISTORY_PROPS;
    }
    const daysBetween = (a: Date, b: Date): number => {
      const ms = Math.max(0, b.getTime() - a.getTime());
      return Math.min(30, Math.max(0, Math.floor(ms / dayMs)));
    };
    const formatRange = (start: Date, end: Date): string => {
      const fmt = (d: Date) => d.toLocaleDateString('en-US', {
        month: 'short',
        day: '2-digit',
        timeZone: 'UTC'
      });
      return `${fmt(start)} – ${fmt(end)}`;
    };
    const weekly = (doc?.weekly_rewards || []).filter((wr: any) => wr.unlock_at && new Date(wr.unlock_at) >= cutoffDate).map((wr: any) => {
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
          const wkStart = wr.week_start ? new Date(wr.week_start) : new Date(getThisFridayStartUTC(unlockAt).getTime() - 7 * dayMs);
          const wkEnd = wr.week_end ? new Date(wr.week_end) : new Date(wkStart.getTime() + 6 * dayMs);
          return formatRange(wkStart, wkEnd);
        })()
      };
    });
    const daily = (doc?.daily_rewards || []).filter((dr: any) => dr.created_at && new Date(dr.created_at) < cutoffDate).map((dr: any) => {
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
    const allRewards = weekly.concat(daily).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
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
        initialCounts: {
          weekly: weekly.length,
          daily: daily.length
        }
      }
    };
  } catch (error) {
    console.error('Failed to load reward history', error);
  }
  return EMPTY_HISTORY_PROPS;
}
