import { Button, Flex, Title } from '@tremor/react';
import Image from 'next/image';
import bgImg from '../assets/background.png';
import { getSession, useSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { Reward } from '../lib/types';
import { useRewardSummary } from '../lib/hooks/useRewardSummary';
import WeeklyCard, { WeeklyRewardView } from '../components/WeeklyCard';
import DailyRow, { DailyRewardView } from '../components/DailyRow';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useModal } from '../app/modalcontext';
import ClaimModal from '../components/modals/Claim';
import BoostModal from '../components/modals/Boost';
import { getClientToken } from '../lib/clientToken';
import { generateRequestSignatureAsync } from '../lib/requestSignature.client';
import { useFingerprintReady } from '../app/fingerprintcontext';
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

const PAGE_SIZE = 10;

// Smart price formatting component with hover tooltip
const TokenPricesBar = () => {
  const [prices, setPrices] = useState<{ fry1?: number; fry2?: number; fnode?: number }>({});

  useEffect(() => {
    let active = true;
    const fetchPrices = async () => {
      try {
        const res = await fetch('/api/price/get', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset_ids: ['924268058', '2485314946', '2485202024'] })
        });
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        setPrices({
          fry1: json?.prices?.['924268058'] ?? 0,
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
      <PriceWithTooltip label="FRY 1.0" price={prices.fry1 || 0} />
      <span className="text-white text-gray-400">•</span>
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
        About FIP-009
      </a>
    </div>
  );
};

export default function History({
  initialRewards,
  initialTotalPages = 0
}: {
  initialRewards: Reward[];
  initialTotalPages?: number;
}) {
  type RewardView = WeeklyRewardView | DailyRewardView;
  const [rewards, setRewards] = useState<RewardView[]>(initialRewards as unknown as RewardView[]);
  const [page, setPage] = useState(1); // Current page
  const [totalPages, setTotalPages] = useState(initialTotalPages); // Total pages
  const [selReward, setSelReward] = useState<Reward | undefined>(undefined);
  const { openModal } = useModal();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const loadingRef = useRef(false);
  const lastLoadedPage = useRef<number>(0);
  const [showFilters, setShowFilters] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [prices, setPrices] = useState<{ fry1?: number; fry2?: number; fnode?: number }>({});
  const { data: session } = useSession();
  const fmtUSD = (v?: number) => {
    const n = Number(v || 0);
    if (!isFinite(n)) return '$0.00';
    if (n >= 1) return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    let s = n.toFixed(8);
    s = s.replace(/0+$/,'');
    if (s.endsWith('.')) s = s.slice(0, -1);
    if (!s.includes('.')) s = `${s}.00`;
    const [int, dec] = s.split('.');
    const dec2 = dec.length < 2 ? dec + '0'.repeat(2 - dec.length) : dec;
    return `$${int}.${dec2}`;
  };

  const { miner_key } = router.query;
  const minerKey = typeof miner_key === 'string' ? miner_key : undefined;
  const { data: summary, mutate: mutateSummary } = useRewardSummary(minerKey);
  const [now, setNow] = useState(() => Date.now());
  const { ready: fingerprintReady } = useFingerprintReady();

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

  const StatusPill = ({
    label,
    value,
    colorClass
  }: {
    label: string;
    value: unknown;
    colorClass: string;
  }) => (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.7rem] font-semibold ${colorClass}`}
    >
      <span className="uppercase tracking-wide text-[0.68rem]">{label}</span>
      <span className="text-white text-sm font-semibold tracking-normal normal-case">
        {formatSummaryValue(value)}
      </span>
    </span>
  );

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

    const fetchData = async (nextPage: number) => {
      if (!fingerprintReady) return;
      if (!minerKey) return;
      if (nextPage <= lastLoadedPage.current) return;
      if (loadingRef.current) return;
      loadingRef.current = true;
      setIsLoading(true);
      try {
        const clientToken = await getClientToken();
        const body = { miner_key: minerKey, page: nextPage };
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = await generateRequestSignatureAsync('POST', '/api/rewards/get-rewards-page', body, timestamp);
        
        const response = await fetch('api/rewards/get-rewards-page', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-client-token': clientToken,
            'x-request-signature': signature,
            'x-request-timestamp': timestamp.toString()
          },
          body: JSON.stringify(body)
        });

      if (response.ok) {
        const result = await response.json();
        setRewards((prev) => {
          if (nextPage === 1) return result.items;
          const existing = new Set(prev.map((p: any) => p._id));
          const deduped = (result.items || []).filter((it: any) => !existing.has(it._id));
          return [...prev, ...deduped];
        });
        setTotalPages(result.totalPages);
        lastLoadedPage.current = nextPage;
        setPage(nextPage);
        return;
      }
    } catch (error) {
      console.error('Failed to fetch rewards page', error);
    } finally {
      setIsLoading(false);
      loadingRef.current = false;
    }
  };

  const handleClaimButton = (reward: Reward) => {
    console.log('Claim Button');
    setSelReward(reward);
    openModal('claim');
  };

  const handleClaim = async (ret: boolean, message: string): Promise<void> => {
    console.log('Claim Action');
    if (!minerKey) return;
    lastLoadedPage.current = 0;
    loadingRef.current = false;
    setPage(1);
    setTotalPages(0);
    setRewards([]);
    await fetchData(1);
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
    lastLoadedPage.current = 0;
    loadingRef.current = false;
    setPage(1);
    setTotalPages(0);
    setRewards([]);
    await fetchData(1);
    if (mutateSummary) await mutateSummary();
  };

  // Reset and fetch on miner_key change (use SSR payload if present)
  useEffect(() => {
    setPage(1);
    if (Array.isArray(initialRewards) && initialRewards.length > 0) {
      setRewards(initialRewards as unknown as RewardView[]);
      lastLoadedPage.current = 1;
      setTotalPages(initialTotalPages || Math.max(1, Math.ceil(initialRewards.length / PAGE_SIZE)));
      return;
    }
    setRewards([]);
    lastLoadedPage.current = 0;
    setTotalPages(initialTotalPages || 0);
    if (minerKey && fingerprintReady) fetchData(1);
  }, [fingerprintReady, initialRewards, initialTotalPages, minerKey]);

  // Fetch live prices for header context
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch('/api/price/get', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ asset_ids: ['924268058','2485314946', '2485202024'] }) });
        if (!res.ok) return;
        const json = await res.json();
        if (!active) return;
        setPrices({ fry1: json?.prices?.['924268058'] ?? 0, fry2: json?.prices?.['2485314946'] ?? 0, fnode: json?.prices?.['2485202024'] ?? 0 });
      } catch {}
    };
    run();
    const id = setInterval(run, 300000);
    return () => { active = false; clearInterval(id); };
  }, []);

  // Device identity (nickname/name and product name)
  const [deviceMeta, setDeviceMeta] = useState<{ nickname?: string; name?: string; productName?: string } | null>(null);
  useEffect(() => {
    if (typeof miner_key !== 'string') return;
    if (!session?.user?.address) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch(`/api/devices/${miner_key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address: session.user.address })
        });
        if (!active) return;
        if (!res.ok) return;
        const json = await res.json();
        const nick = json?.device?.nickname;
        const name = json?.device?.name;
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
          }
        } catch {}
        setDeviceMeta({ nickname: nick, name, productName });
      } catch {}
    })();
    return () => { active = false; };
  }, [miner_key, session?.user?.address]);

  // (moved) Infinite scroll observer defined after derived lists for type safety

  const handleNext = () => {
    if (page < totalPages && !isLoading) {
      const next = page + 1;
      setPage(next);
      fetchData(next);
    }
  };

  const handlePrev = () => {
    // For Prev, we just change page indicator; items already appended remain
    if (page > 1) setPage((prev) => prev - 1);
  };

  // Derived tabs and filters
  const [tab, setTab] = useState<'weekly' | 'daily'>('weekly');
  const [status, setStatus] = useState<'all' | 'pending' | 'claimable' | 'claimed'>('all');
  // Removed asset filter; using miner dropdown instead
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');

  const itemsWeekly: WeeklyRewardView[] = (rewards || []).filter((r): r is WeeklyRewardView => (r as any).isWeekly === true);
  const itemsDaily: DailyRewardView[] = (rewards || []).filter((r): r is DailyRewardView => (r as any).isWeekly !== true);
  // const allAssets = Array.from(new Set((rewards || []).map((r) => r.asset_id))).filter((id) => id);

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

  // Infinite scroll observer (after weeklyList/dailyList are declared)
  useEffect(() => {
    if (!fingerprintReady) return;
    if (!sentinelRef.current) return;
    const el = sentinelRef.current;
    const io = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (!entry.isIntersecting) return;
      // Avoid churning through pages when current tab has no results
      const currentTabCount = tab === 'weekly' ? weeklyList.length : dailyList.length;
      if (currentTabCount === 0) return;
      if (totalPages && lastLoadedPage.current >= totalPages) return;
      const next = (lastLoadedPage.current || (rewards.length > 0 ? 1 : 0)) + 1;
      if (totalPages && next > totalPages) return;
      if (!loadingRef.current) {
        fetchData(next);
      }
    }, { rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [dailyList.length, fingerprintReady, minerKey, rewards.length, tab, totalPages, weeklyList.length]);

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
          <div className="flex flex-wrap gap-2">
            <StatusPill
              label="Accruing"
              value={summary.accruing ?? 0}
              colorClass="border-sky-500/60 bg-sky-500/15 text-sky-200"
            />              
            <StatusPill
              label="Pending"
              value={summary.pending ?? 0}
              colorClass="border-amber-500/60 bg-amber-500/15 text-amber-200"
            />
            <StatusPill
              label="Claimable"
              value={summary.claimable ?? 0}
              colorClass="border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
            />
            {typeof summary.claimed === 'number' && (
              <StatusPill
                label="Claimed"
                value={summary.claimed}
                colorClass="border-gray-600 bg-gray-800 text-gray-300"
              />
            )}
          </div>
        )}
      </div>
      <div className="px-2 sm:px-20 mt-6">
        {/* Tabs + Status on left; compact date filters on right */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justjfyfy-between">
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={() => setTab('weekly')} className={`px-3 py-1 rounded-full border whitespace-nowrap ${tab==='weekly'?'border-red-600 bg-red-600/20 text-white':'border-gray-700 text-gray-400'}`}>Weekly</button>
            <button onClick={() => setTab('daily')} className={`px-3 py-1 rounded-full border whitespace-nowrap ${tab==='daily'?'border-red-600 bg-red-600/20 text-white':'border-gray-700 text-gray-400'}`}>Legacy Daily</button>
            {(['all','pending','claimable','claimed'] as const).map(s => (
              <button key={s} onClick={()=>setStatus(s)} className={`px-3 py-1 text-xs rounded-full whitespace-nowrap ${status===s?'bg-red-600/20 border border-red-600 text-white':'border border-gray-700 text-gray-400'}`}>{s}</button>
            ))}
            <button className="sm:hidden ml-2 px-3 py-1 border border-gray-700 rounded" onClick={()=>setShowFilters(!showFilters)}>{showFilters ? 'Hide Filters' : 'Filters'}</button>
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
          <div ref={sentinelRef} />
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
  useEffect(() => {
    let active = true;
    const run = async () => {
      try {
        const res = await fetch('/api/devices/list', { method: 'POST' });
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
  }, []);
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

export async function getServerSideProps(context: any) {
  const session = await getSession(context);

  if (!session || !session.user) {
    return {
      props: { initialRewards: [], initialTotalPages: 0 }
    };
  }

  const query = context.query;
  if (!query) {
    return {
      props: { initialRewards: [], initialTotalPages: 0 }
    };
  }

  const { miner_key } = query;

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const CUTOFF_ISO = process.env.WEEKLY_CUTOFF_UTC || '2025-09-12T00:00:00.000Z';
    const CUTOFF_DATE = new Date(CUTOFF_ISO);

    const doc = await db.collection('device-rewards').findOne({ miner_key });
    if (!doc) {
      return { props: { initialRewards: [], initialTotalPages: 0 } };
    }

    const dayMs = 24 * 60 * 60 * 1000;
    const getThisFridayStartUTC = (ref: Date): Date => {
      const d = new Date(Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate(), 0, 0, 0, 0));
      const day = d.getUTCDay();
      const diffToFriday = (day + 7 - 5) % 7;
      d.setUTCDate(d.getUTCDate() - diffToFriday);
      return d;
    };
    const daysBetween = (a: Date, b: Date): number => {
      const ms = Math.max(0, b.getTime() - a.getTime());
      return Math.min(30, Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24))));
    };
    const formatRange = (start: Date, end: Date): string => {
      const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: 'UTC' });
      return `${fmt(start)} – ${fmt(end)}`;
    };

    const weekly = (doc?.weekly_rewards || [])
      .filter((wr: any) => wr.unlock_at && new Date(wr.unlock_at) >= CUTOFF_DATE)
      .map((wr: any) => ({
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
        progressDays: daysBetween(new Date(wr.unlock_at), new Date()),
        etaDate: new Date(new Date(wr.unlock_at).getTime() + 30 * dayMs),
        weekLabel: (() => {
          const wkStart = wr.week_start ? new Date(wr.week_start) : new Date(getThisFridayStartUTC(new Date(wr.unlock_at)).getTime() - 7 * dayMs);
          const wkEnd = wr.week_end ? new Date(wr.week_end) : new Date(wkStart.getTime() + 6 * dayMs);
          return formatRange(wkStart, wkEnd);
        })()
      }));

    const daily = (doc?.daily_rewards || [])
      .filter((dr: any) => dr.created_at && new Date(dr.created_at) < CUTOFF_DATE)
      .map((dr: any) => ({
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
        progressDays: daysBetween(new Date(dr.created_at), new Date()),
        etaDate: new Date(new Date(dr.created_at).getTime() + 30 * dayMs)
      }));

    const rewards = weekly.concat(daily)
      .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10);

    const totalRewards = weekly.length + daily.length;
    const totalPages = totalRewards > 0 ? Math.ceil(totalRewards / PAGE_SIZE) || 1 : 0;

    return {
      props: {
        initialRewards: JSON.parse(JSON.stringify(rewards)),
        initialTotalPages: totalPages
      }
    };
  } catch (error) {}

  return {
    props: { initialRewards: [], initialTotalPages: 0 }
  };
}
