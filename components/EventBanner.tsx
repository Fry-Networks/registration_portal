'use client';

import { useTheme } from 'next-themes';
import Link from 'next/link';

type ActiveEvent = {
  _id: string;
  name: string;
  description?: string;
  endDate: string;
  myRank?: number | null;
  myTier?: { tier: string; description: string } | null;
  leaderboardCount: number;
  prizeTiers?: Array<{ tier: string; description: string; amount: number; type: string; maxRank: number }>;
};

function timeRemaining(endDate: string): string {
  const diff = new Date(endDate).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  if (days > 0) return `${days}d ${hours}h remaining`;
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m remaining`;
}

export default function EventBanner({ event }: { event: ActiveEvent }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  const status = timeRemaining(event.endDate) === 'Ended' ? 'ended' : 'active';
  const statusBadge = status === 'active'
    ? (isDark ? 'bg-green-500/20 text-green-300 border border-green-500/30' : 'bg-green-100 text-green-800 border border-green-300')
    : (isDark ? 'bg-red-500/20 text-red-300 border border-red-500/30' : 'bg-red-100 text-red-800 border border-red-300');

  return (
    <Link href={`/events/${event._id}`} className="block">
      <div
        className={`relative overflow-hidden rounded-2xl border p-5 transition hover:scale-[1.005] ${
          isDark
            ? 'border-red-500/30 bg-gradient-to-r from-red-900/20 via-black to-red-900/20'
            : 'border-red-200 bg-gradient-to-r from-red-50 via-white to-red-50'
        }`}
      >
        {/* D6: Status badge */}
        <div className={`absolute top-3 right-3 rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${statusBadge}`}>
          {status === 'active' ? 'Active' : 'Ended'}
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">🏆</span>
              <h3
                className={`text-lg font-bold ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {event.name}
              </h3>
            </div>
            {event.description && (
              <p
                className={`mt-1 text-sm ${
                  isDark ? 'text-white/70' : 'text-slate-600'
                }`}
              >
                {event.description}
              </p>
            )}
            <p
              className={`mt-2 text-xs font-medium ${
                isDark ? 'text-red-400' : 'text-red-600'
              }`}
            >
              {timeRemaining(event.endDate)} · {event.leaderboardCount}{' '}
              participants
            </p>
          </div>
          <div className="flex items-center gap-4">
            {event.myRank ? (
              <div className="text-center space-y-1">
                <p className={`text-2xl font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  #{event.myRank}
                </p>
                <p className={`text-xs ${isDark ? 'text-white/60' : 'text-slate-500'}`}>Your rank</p>
                {event.myTier && (
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${isDark ? 'bg-warning-500/20 text-warning-300' : 'bg-warning-100 text-warning-800'}`}>
                    {event.myTier.tier}
                  </span>
                )}
                <span className={`inline-block mt-1 rounded-lg px-3 py-1 text-xs font-semibold ${isDark ? 'bg-red-600 text-white' : 'bg-red-600 text-white'}`}>
                  View Leaderboard →
                </span>
              </div>
            ) : (
              <span className={`inline-block rounded-lg px-3 py-1 text-xs font-semibold ${isDark ? 'bg-red-600 text-white' : 'bg-red-600 text-white'}`}>
                Join Competition →
              </span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
