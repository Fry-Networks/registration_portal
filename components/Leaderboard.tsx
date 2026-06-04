'use client';

import { useTheme } from 'next-themes';

type PrizeTier = { tier: string; description: string; type: string; amount: number; maxRank: number };
type LeaderboardEntry = { wallet: string; score: number; lastCalculated?: string; source?: string };

function getTierForRank(rank: number, tiers: PrizeTier[]): PrizeTier | null {
  const sorted = [...tiers].sort((a, b) => a.maxRank - b.maxRank);
  for (const tier of sorted) {
    if (rank <= tier.maxRank) return tier;
  }
  return null;
}

function tierBadgeColor(tier: PrizeTier): string {
  if (tier.maxRank <= 1) return 'bg-warning-500/20 text-warning-300 border-warning-500/40';
  if (tier.maxRank <= 3) return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
  if (tier.maxRank <= 25) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
  if (tier.maxRank <= 50) return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
  return 'bg-gray-500/20 text-gray-300 border-gray-500/40';
}

function truncateWallet(wallet: string): string {
  if (wallet.length <= 16) return wallet;
  return `${wallet.slice(0, 6)}...${wallet.slice(-6)}`;
}

export default function Leaderboard({
  entries,
  prizeTiers = [],
  myWallet,
  limit,
}: {
  entries: LeaderboardEntry[];
  prizeTiers?: PrizeTier[];
  myWallet?: string;
  limit?: number;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const sorted = entries.slice().sort((a, b) => b.score - a.score);
  const display = limit ? sorted.slice(0, limit) : sorted;

  if (display.length === 0) {
    return (
      <p className={`text-sm ${isDark ? 'text-gray-500' : 'text-slate-500'}`}>
        No leaderboard entries yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {display.map((entry, i) => {
        const rank = i + 1;
        const isMe = myWallet && entry.wallet === myWallet;
        const tier = prizeTiers.length > 0 ? getTierForRank(rank, prizeTiers) : null;

        return (
          <div
            key={entry.wallet}
            className={`flex items-center justify-between gap-3 rounded-xl border p-3 transition ${
              isMe
                ? isDark
                  ? 'border-red-500/60 bg-red-500/10 ring-1 ring-red-500/30'
                  : 'border-red-400 bg-red-50 ring-1 ring-red-300'
                : isDark
                ? 'border-white/10 bg-white/5'
                : 'border-slate-200 bg-white'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  rank <= 3
                    ? 'bg-gradient-to-br from-warning-400 to-primary-500 text-black'
                    : isDark
                    ? 'bg-white/10 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {rank}
              </span>
              <div className="min-w-0">
                <p
                  className={`text-sm font-mono truncate ${
                    isMe
                      ? isDark
                        ? 'text-red-300 font-semibold'
                        : 'text-red-700 font-semibold'
                      : isDark
                      ? 'text-white/80'
                      : 'text-slate-700'
                  }`}
                >
                  {truncateWallet(entry.wallet)}
                  {isMe && (
                    <span className="ml-2 text-xs font-normal opacity-70">
                      (you)
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span
                className={`text-lg font-bold tabular-nums ${
                  isDark ? 'text-white' : 'text-slate-900'
                }`}
              >
                {entry.score}
              </span>
              {tier && (
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                    isDark ? tierBadgeColor(tier) : 'bg-slate-100 text-slate-700 border-slate-200'
                  }`}
                >
                  {tier.tier}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
