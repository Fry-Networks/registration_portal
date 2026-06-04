import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import EventBanner from '../components/EventBanner';
import PageShell from '../components/PageShell';

type PrizeTier = { tier: string; description: string; type: string; amount: number; maxRank: number };
type EventSummary = {
  _id: string;
  name: string;
  description?: string;
  status: string;
  startDate: string;
  endDate: string;
  prize?: { type?: string; amount?: number };
  prizeTiers?: PrizeTier[];
  metric: { type: string; lastRefreshAt?: string };
  leaderboardCount: number;
  topEntries: Array<{ wallet: string; score: number }>;
  myRank: number | null;
  myScore: number | null;
  myTier: PrizeTier | null;
  bannerImage?: string;
};

export default function EventsPage() {
  const { data: session } = useSession();
  const { activeAccount } = useWallet();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  const [active, setActive] = useState<EventSummary[]>([]);
  const [recent, setRecent] = useState<EventSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'ended' | 'upcoming'>('all');

  useEffect(() => {
    if (!activeAccount) return;
    const fetchEvents = async () => {
      setLoading(true);
      try {
        const res = await fetch('/api/events/active');
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const data = await res.json();
        setActive(data.active ?? []);
        setRecent(data.recent ?? []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, [activeAccount]);

  if (!activeAccount) {
    return (
      <PageShell title="Events & Competitions" breadcrumb={true}>
        <div className="min-h-[50vh] flex items-center justify-center">
          <div className="text-center">
            <div className="w-16 h-16 rounded-full bg-surface-strong border border-divider flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v3m-6 0h12a2 2 0 002-2v-5a2 2 0 00-2-2H6a2 2 0 00-2 2v5a2 2 0 002 2z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a5 5 0 00-10 0v2" />
              </svg>
            </div>
            <p className="text-ink-secondary font-body">Connect your wallet to view events.</p>
          </div>
        </div>
      </PageShell>
    );
  }

  const allEvents = [...active, ...recent];
  const q = searchQuery.trim().toLowerCase();
  const filtered = allEvents.filter((e) => {
    const matchesSearch = !q || e.name.toLowerCase().includes(q);
    const matchesStatus =
      statusFilter === 'all'
        ? true
        : statusFilter === 'active'
        ? e.status === 'active' || e.status === 'ending_soon'
        : e.status === statusFilter;
    return matchesSearch && matchesStatus;
  });
  const activeEvents = filtered.filter((e) => e.status === 'active' || e.status === 'ending_soon');
  const pastEvents = filtered.filter((e) => e.status === 'ended' || e.status === 'upcoming');

  return (
    <PageShell title="Events & Competitions" breadcrumb={true}>
      <div className="max-w-6xl mx-auto px-4 py-space-6">
        {/* Search + filter pills */}
        <div className="flex flex-col sm:flex-row gap-space-3 mb-space-6">
          <div className="relative w-full sm:w-1/2">
            <input
              type="text"
              placeholder="Search events..."
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
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'ended', 'upcoming'] as const).map((status) => (
              <button
                key={status}
                onClick={() => setStatusFilter(status)}
                className={`px-3 py-1 rounded-token-full text-xs font-semibold border transition font-body ${
                  statusFilter === status
                    ? 'bg-primary-500 text-ink border-primary-500'
                    : 'bg-surface-strong text-ink-secondary border-divider hover:text-ink hover:border-primary-500/50'
                }`}
              >
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <div className="py-space-8 text-center">
            <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm text-ink-secondary font-body">Loading events...</p>
          </div>
        )}

        {error && (
          <div className="py-space-8 text-center">
            <p className="text-error-500 font-body">{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Active events banner section */}
            {activeEvents.length > 0 && (
              <div className="mb-space-8">
                <h2 className="text-lg font-display font-semibold text-ink mb-space-4">
                  Active Competitions <span className="text-primary-500">({activeEvents.length})</span>
                </h2>
                <div className="space-y-space-4">
                  {activeEvents.map((event) => (
                    <div
                      key={event._id}
                      className="bg-gradient-to-r from-primary-900/50 to-accent-900/30 border border-primary-500/20 rounded-token-xl p-space-6"
                    >
                      <div className="flex items-center gap-3 flex-wrap">
                        <h3 className="text-2xl font-display font-bold text-ink">{event.name}</h3>
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-token-full text-xs font-semibold ${
                            event.status === 'active'
                              ? 'bg-success-500/20 text-success-400'
                              : 'bg-warning-500/20 text-warning-400'
                          }`}
                        >
                          {event.status === 'active' ? 'Active' : 'Ending Soon'}
                        </span>
                      </div>
                      {event.description && (
                        <p className="text-ink-secondary mt-2 font-body">{event.description}</p>
                      )}
                      <div className="mt-4 flex items-center gap-4 flex-wrap text-sm text-ink-secondary font-body">
                        <span>{event.leaderboardCount} participants</span>
                        {event.prize?.amount && (
                          <span className="text-primary-500 font-semibold">
                            {event.prize.amount} {event.prize.type}
                          </span>
                        )}
                      </div>
                      <Link
                        href={`/events/${event._id}`}
                        className="inline-block bg-primary-500 hover:bg-primary-600 text-ink px-5 py-2.5 rounded-token-md font-semibold mt-4 transition"
                      >
                        {event.myRank != null ? 'View Leaderboard →' : 'Join Competition →'}
                      </Link>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Past / upcoming events grid */}
            {pastEvents.length > 0 && (
              <div className="mt-space-8">
                <h2 className="text-lg font-display font-semibold text-ink mb-space-4">
                  {statusFilter === 'upcoming' ? 'Upcoming Events' : 'Past Events'}
                  <span className="text-primary-500 ml-1">({pastEvents.length})</span>
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-4">
                  {pastEvents.map((event) => (
                    <Link
                      key={event._id}
                      href={`/events/${event._id}`}
                      className="block"
                    >
                      <div className="bg-surface-elevated border border-divider rounded-token-lg p-space-4 transition hover:border-primary-500/30 hover:-translate-y-0.5">
                        <div className="flex items-center justify-between mb-2">
                          <span
                            className={`inline-flex items-center rounded-token-md px-2 py-0.5 text-xs font-medium border ${
                              event.status === 'ended'
                                ? 'bg-error-500/10 text-error-500 border-error-500/20'
                                : 'bg-accent-500/10 text-accent-500 border-accent-500/20'
                            }`}
                          >
                            {event.status === 'ended' ? 'Ended' : 'Upcoming'}
                          </span>
                          {event.myRank != null && (
                            <span className="text-sm font-bold text-primary-500">#{event.myRank}</span>
                          )}
                        </div>
                        <h3 className="text-lg font-bold text-ink font-display">{event.name}</h3>
                        <p className="text-sm text-ink-secondary mt-1 font-body">
                          {new Date(event.startDate).toLocaleDateString()} – {new Date(event.endDate).toLocaleDateString()}
                        </p>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-xs text-ink-muted font-body">
                            {event.leaderboardCount} participants
                          </span>
                          <span className="text-primary-500 hover:text-primary-400 text-sm font-medium transition">
                            View Results →
                          </span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Empty state */}
            {filtered.length === 0 && (
              <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-8 text-center">
                <div className="w-16 h-16 rounded-full bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-primary-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </div>
                <p className="font-semibold text-ink font-body">No events found.</p>
                <p className="text-sm text-ink-secondary mt-1 font-body">Try adjusting your search or filters.</p>
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  );
}
