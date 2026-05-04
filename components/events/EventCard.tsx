import React from 'react';
import StatusPill from '../StatusPill';
import EventLeaderboard, { LeaderboardEntry } from './EventLeaderboard';

export interface EventPrize {
  type: string;
  amount: number;
  description?: string;
  paidTxId?: string;
}

export interface EventMetric {
  type: 'manual' | 'aem_count' | 'device_count';
  config?: Record<string, unknown>;
  lastRefreshAt?: string | Date;
  lastRefreshStatus?: 'ok' | 'skipped' | 'failed';
  lastRefreshError?: string;
}

export interface EventWinner {
  wallet?: string;
  score?: number;
  declaredAt?: string | Date;
  declaredBy?: string;
  prizeTxId?: string;
}

export interface DashboardEvent {
  _id: string;
  name: string;
  description?: string;
  status: 'draft' | 'active' | 'ended' | 'cancelled';
  startDate: string | Date;
  endDate: string | Date;
  prize?: EventPrize;
  metric?: EventMetric;
  leaderboard?: LeaderboardEntry[];
  winner?: EventWinner;
  bannerImage?: string;
  ctaLink?: string;
  audience?: string;
  created_by?: string;
  created_at?: string | Date;
  updated_at?: string | Date;
}

interface EventCardProps {
  event: DashboardEvent;
}

function formatDate(value: string | Date | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function statusTone(status: DashboardEvent['status']) {
  switch (status) {
    case 'active': return 'success' as const;
    case 'ended': return 'info' as const;
    case 'cancelled': return 'muted' as const;
    default: return 'warning' as const;
  }
}

export default function EventCard({ event }: EventCardProps) {
  const [expanded, setExpanded] = React.useState(false);

  const prizeAmount = event.prize?.amount ?? 0;
  const prizeType = event.prize?.type ?? '';
  const prizeDesc = event.prize?.description;

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/80 text-slate-900 shadow-md shadow-slate-200/60 ring-1 ring-slate-200/60 dark:border-white/10 dark:bg-gray-950/60 dark:text-slate-100 dark:shadow-none transition">
      {event.bannerImage && (
        <div className="relative w-full h-40 sm:h-48 overflow-hidden rounded-t-2xl">
          <img
            src={event.bannerImage}
            alt={event.name || 'Event banner'}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute bottom-3 left-4 right-4">
            <StatusPill label={event.status} tone={statusTone(event.status)} className="text-[0.7rem] py-0.5 px-2" />
          </div>
        </div>
      )}
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            {!event.bannerImage && (
              <div className="mb-2"><StatusPill label={event.status} tone={statusTone(event.status)} className="text-[0.7rem] py-0.5 px-2" /></div>
            )}
            <h3 className="text-lg font-semibold leading-tight">{event.name || 'Untitled Event'}</h3>
            {event.description && <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{event.description}</p>}
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Prize</div>
            <div className="text-xl font-bold">{prizeAmount.toLocaleString()} {prizeType}</div>
            {prizeDesc && <div className="text-xs text-slate-500 dark:text-slate-400">{prizeDesc}</div>}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
          <span>Start: {formatDate(event.startDate)}</span>
          <span className="hidden sm:inline">•</span>
          <span>End: {formatDate(event.endDate)}</span>
          {event.metric?.type && (
            <>
              <span className="hidden sm:inline">•</span>
              <span>Metric: {event.metric.type}</span>
            </>
          )}
        </div>

        {event.winner?.wallet && (
          <div className="mt-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50/60 dark:border-emerald-500/30 dark:bg-emerald-500/10">
            <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Winner</div>
            <div className="text-sm text-emerald-900 dark:text-emerald-100">{event.winner.wallet}</div>
            <div className="text-xs text-emerald-600 dark:text-emerald-300">Score: {event.winner.score?.toLocaleString() ?? '—'} — Declared {formatDate(event.winner.declaredAt)}</div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="px-3 py-1.5 rounded-lg border text-sm transition-colors duration-150 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {expanded ? 'Hide Leaderboard' : 'Show Leaderboard'}
          </button>
          {event.ctaLink && (
            <a
              href={event.ctaLink}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 rounded-lg border text-sm transition-colors duration-150 border-sky-300 dark:border-sky-600 text-sky-700 dark:text-sky-200 hover:bg-sky-50 dark:hover:bg-sky-900/30"
            >
              Open Link ↗
            </a>
          )}
        </div>

        {expanded && (
          <div className="mt-4">
            <EventLeaderboard leaderboard={event.leaderboard || []} />
          </div>
        )}
      </div>
    </div>
  );
}
