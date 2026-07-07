import PageShell from "../../components/PageShell";
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import Leaderboard from '../../components/Leaderboard';
type PrizeTier = {
  tier: string;
  description: string;
  type: string;
  amount: number;
  maxRank: number;
};
type WinnerEntry = {
  wallet: string;
  rank: number;
  tier: string;
  prizeTxId?: string;
};
type LeaderboardEntry = {
  wallet: string;
  score: number;
  lastCalculated?: string;
  source?: string;
};
type EventDetail = {
  _id: string;
  name: string;
  description?: string;
  status: string;
  startDate: string;
  endDate: string;
  prize?: {
    type?: string;
    amount?: number;
    description?: string;
  };
  prizeTiers?: PrizeTier[];
  winners?: WinnerEntry[];
  metric: {
    type: string;
    lastRefreshAt?: string;
  };
  bannerImage?: string;
  ctaLink?: string;
};
function timeRemaining(endDate: string): string {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor(diff % (1000 * 60 * 60 * 24) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h remaining`;
  const minutes = Math.floor(diff % (1000 * 60 * 60) / (1000 * 60));
  return `${hours}h ${minutes}m remaining`;
}
export default function EventDetailPage() {
  const router = useRouter();
  const {
    id
  } = router.query;
  const {
    data: session
  } = useSession();
  const {
    activeAccount
  } = useWallet();
  const {
    resolvedTheme
  } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [myRank, setMyRank] = useState<number | null>(null);
  const [myScore, setMyScore] = useState<number | null>(null);
  const [myTier, setMyTier] = useState<PrizeTier | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [claiming, setClaiming] = useState(false);
  const [claimError, setClaimError] = useState<string | null>(null);
  const handleClaimFreeFem = async () => {
    if (!activeAccount?.address) return;
    setClaiming(true);
    setClaimError(null);
    try {
      const res = await fetch('/api/events/claim-free-fem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (!res.ok) {
        setClaimError(data.message || 'Failed to generate key');
        return;
      }
      const minerKey = data.minerKey;
      if (minerKey) {
        router.push(`/register?minerKey=${encodeURIComponent(minerKey)}&type=fem`);
      }
    } catch (e: any) {
      setClaimError(e.message || 'Network error');
    } finally {
      setClaiming(false);
    }
  };
  useEffect(() => {
    if (!id || !session) return;
    const fetchEvent = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/events/${id}`);
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        setEvent(data.event);
        setLeaderboard(data.leaderboard ?? []);
        setMyRank(data.myRank);
        setMyScore(data.myScore);
        setMyTier(data.myTier);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchEvent();
  }, [id, session]);
  if (loading) {
    return (
      <PageShell title="Event Details" breadcrumb={true}>
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      </PageShell>
    );
  }
  if (!event) {
    return (
      <PageShell title="Event Details" breadcrumb={true}>
        <div className="max-w-5xl mx-auto px-4 py-space-8">
          <Link href="/events" className="text-sm text-ink-secondary hover:text-ink transition inline-flex items-center gap-1 font-body">
            ← Back to events
          </Link>
          <p className="mt-4 text-error-500 font-body">{error || 'Event not found'}</p>
        </div>
      </PageShell>
    );
  }
  const isActive = event.status === 'active';
  const hasPrizeTiers = (event.prizeTiers?.length ?? 0) > 0;
  const hasWinners = (event.winners?.length ?? 0) > 0;

  const filteredLeaderboard = searchQuery.trim()
    ? leaderboard.filter(e =>
        e.wallet.toLowerCase().includes(searchQuery.trim().toLowerCase())
      )
    : leaderboard;

  return (
    <PageShell title="Event Details" breadcrumb={true}>
      <div className="max-w-5xl mx-auto px-4 py-space-8">
        <Link href="/events" className="text-sm text-ink-secondary hover:text-ink transition inline-flex items-center gap-1 font-body">
          ← Back to events
        </Link>

        {/* Header */}
        <div className="mt-space-6 flex flex-col md:flex-row items-start justify-between gap-4">
          <div className="flex-1">
            <h1 className="text-2xl font-display font-bold text-ink">{event.name}</h1>
            <div className="flex gap-2 items-center mt-2 flex-wrap">
              <span className={`inline-flex items-center rounded-token-md px-2.5 py-1 text-xs font-semibold border ${isActive ? 'bg-success-500/10 text-success-500 border-success-500/20' : event.status === 'ended' ? 'bg-error-500/10 text-error-500 border-error-500/20' : 'bg-warning-500/10 text-warning-500 border-warning-500/20'}`}>
                {isActive ? 'Active' : event.status === 'ended' ? 'Ended' : 'Upcoming'}
              </span>
              <span className="text-sm text-ink-muted font-body">
                {new Date(event.startDate).toLocaleDateString()} — {new Date(event.endDate).toLocaleDateString()}
              </span>
              {isActive && <span className="text-sm text-success-500 font-medium font-body">{timeRemaining(event.endDate)}</span>}
            </div>
            {event.description && <p className="text-sm text-ink-secondary mt-3 font-body">{event.description}</p>}
          </div>

          {myRank && (
            <div className="bg-surface-elevated border border-primary-500/20 rounded-token-xl p-4 text-center min-w-[140px]">
              <p className="text-3xl font-display font-bold text-primary-500">#{myRank}</p>
              <p className="text-xs text-ink-secondary mt-1 font-body">Your rank</p>
              {myScore !== null && <p className="text-sm font-semibold text-ink mt-1 font-body">{myScore} FEMs</p>}
              {myTier && <p className="text-xs text-accent-500 mt-1 font-body">{myTier.description}</p>}
            </div>
          )}
        </div>

        {/* Prize Tiers */}
        {hasPrizeTiers && (
          <div className="mt-space-8 bg-surface-elevated border border-divider rounded-token-xl p-space-5">
            <h2 className="text-lg font-display font-semibold text-ink mb-4">Prize Tiers</h2>
            <div className="space-y-2">
              {event.prizeTiers!.sort((a, b) => a.maxRank - b.maxRank).map((tier, i) => {
                const qualifies = myRank !== null && myRank <= tier.maxRank;
                return (
                  <div key={i} className={`flex items-center justify-between gap-3 rounded-token-lg border p-3 transition ${qualifies ? 'bg-primary-500/5 border-primary-500/20' : 'bg-surface-strong border-divider'}`}>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-ink font-display">{tier.tier}</span>
                      <span className="text-sm text-ink-secondary font-body">{tier.description}</span>
                      {qualifies && <span className="text-xs text-primary-500 font-semibold font-body">✓ You qualify</span>}
                    </div>
                    <span className="text-sm text-ink-muted font-body">Rank ≤ {tier.maxRank}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Free FEM Key CTA */}
        {activeAccount && (
          <div className="mt-space-8 bg-accent-500/5 border border-accent-500/20 rounded-token-xl p-space-5">
            <h3 className="text-lg font-display font-semibold text-ink">
              Need a FEM key to compete?
            </h3>
            <p className="mt-1 text-sm text-ink-secondary font-body">
              Generate a free FEM key and register it to start competing. Your key will be created instantly and linked to your wallet.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <button
                onClick={handleClaimFreeFem}
                disabled={claiming}
                className={`rounded-token-md px-4 py-2 text-sm font-semibold transition ${claiming ? 'opacity-50 cursor-not-allowed bg-surface-strong text-ink-muted' : 'bg-accent-500 hover:bg-accent-600 text-white'}`}
              >
                {claiming ? 'Generating...' : 'Generate Free FEM Key'}
              </button>
              {claimError && <span className="text-sm text-error-500 font-body">{claimError}</span>}
            </div>
          </div>
        )}

        {/* Winners (ended events) */}
        {hasWinners && (
          <div className="mt-space-8 bg-surface-elevated border border-divider rounded-token-xl p-space-5">
            <h2 className="text-lg font-display font-semibold text-ink mb-4">Winners</h2>
            <div className="space-y-2">
              {event.winners!.map((w, i) => (
                <div key={i} className="flex items-center justify-between gap-3 bg-surface-strong border border-divider rounded-token-md p-3">
                  <div className="flex items-center gap-3">
                    <span className="font-bold text-ink font-display">#{w.rank}</span>
                    <span className="font-mono text-xs text-ink-secondary">
                      {w.wallet.slice(0, 8)}...{w.wallet.slice(-6)}
                    </span>
                  </div>
                  <span className="text-xs font-semibold rounded-token-md px-2 py-0.5 bg-primary-500/10 text-primary-500 border border-primary-500/20">
                    {w.tier}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Leaderboard */}
        <div className="mt-space-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-space-4 gap-3">
            <h2 className="text-lg font-display font-semibold text-ink">
              Leaderboard <span className="text-ink-secondary">({leaderboard.length} participants)</span>
            </h2>
            <div className="relative w-full max-w-md">
              <input
                type="text"
                placeholder="Search by wallet or nickname..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-surface-strong border border-divider rounded-token-lg px-4 py-2 text-sm text-ink placeholder-ink-secondary outline-none focus:ring-2 focus:ring-primary-500/40 transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-secondary hover:text-primary-500 transition"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {event.metric.lastRefreshAt && (
            <p className="text-xs text-ink-muted font-body mb-space-2">
              Updated {new Date(event.metric.lastRefreshAt).toLocaleString()}
            </p>
          )}

          {/* Desktop table */}
          <div className="hidden md:block">
            <div className="grid grid-cols-[0.5fr_2fr_1fr_1fr] gap-2 text-xs text-ink-secondary uppercase tracking-wider font-display border-b border-divider pb-2 px-4">
              <div>Rank</div>
              <div>Wallet</div>
              <div className="text-right">Score</div>
              <div className="text-right">Prize</div>
            </div>
            <div className="space-y-2 mt-2">
              {filteredLeaderboard.map((entry, idx) => {
                const isMe = activeAccount?.address && entry.wallet === activeAccount.address;
                const rank = idx + 1;
                const tier = event.prizeTiers?.find(t => rank <= t.maxRank);
                let rowClasses = 'grid grid-cols-[0.5fr_2fr_1fr_1fr] gap-2 items-center px-4 py-3 text-sm transition ';
                if (rank === 1) {
                  rowClasses += 'bg-primary-500/20 border-l-4 border-primary-500 rounded-token-md';
                } else if (rank === 2) {
                  rowClasses += 'bg-accent-500/10 border-l-4 border-accent-500 rounded-token-md';
                } else if (rank === 3) {
                  rowClasses += 'bg-warning-500/10 border-l-4 border-warning-500 rounded-token-md';
                } else {
                  rowClasses += 'bg-surface-elevated border border-divider rounded-token-md hover:bg-surface-strong';
                }
                return (
                  <div key={entry.wallet} className={rowClasses}>
                    <div className="font-display font-bold text-ink">
                      {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
                    </div>
                    <div className="flex items-center gap-2 group">
                      <span className="font-mono text-xs text-ink-secondary">
                        {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                      </span>
                      <button
                        onClick={() => navigator.clipboard.writeText(entry.wallet)}
                        className="opacity-0 group-hover:opacity-100 transition text-ink-secondary hover:text-primary-500"
                        title="Copy wallet"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      {isMe && <span className="text-xs text-primary-500 font-semibold font-body">You</span>}
                    </div>
                    <div className="text-right font-semibold text-ink font-display">{entry.score}</div>
                    <div className="text-right text-sm text-ink-secondary font-body">
                      {tier?.tier || '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mobile card stack */}
          <div className="md:hidden space-y-3">
            {filteredLeaderboard.map((entry, idx) => {
              const isMe = activeAccount?.address && entry.wallet === activeAccount.address;
              const rank = idx + 1;
              const tier = event.prizeTiers?.find(t => rank <= t.maxRank);
              let cardClasses = 'bg-surface-elevated border border-divider rounded-token-lg p-space-4 ';
              if (rank === 1) {
                cardClasses += 'bg-primary-500/20 border-l-4 border-primary-500';
              } else if (rank === 2) {
                cardClasses += 'bg-accent-500/10 border-l-4 border-accent-500';
              } else if (rank === 3) {
                cardClasses += 'bg-warning-500/10 border-l-4 border-warning-500';
              }
              return (
                <div key={entry.wallet} className={cardClasses}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-2xl font-display font-bold text-ink">
                      {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`}
                    </span>
                    {isMe && <span className="text-xs text-primary-500 font-semibold font-body">You</span>}
                  </div>
                  <div className="flex items-center gap-2 group mb-2">
                    <span className="font-mono text-sm text-ink-secondary break-all">
                      {entry.wallet.slice(0, 8)}...{entry.wallet.slice(-6)}
                    </span>
                    <button
                      onClick={() => navigator.clipboard.writeText(entry.wallet)}
                      className="text-ink-secondary hover:text-primary-500 transition shrink-0"
                      title="Copy wallet"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-ink-secondary font-body">Score</span>
                    <span className="font-semibold text-ink font-display">{entry.score}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-ink-secondary font-body">Prize</span>
                    <span className="text-ink-secondary font-body">{tier?.tier || '—'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </PageShell>
  );
}

