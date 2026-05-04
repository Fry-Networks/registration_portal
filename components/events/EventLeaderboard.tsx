import React from 'react';
import StatusPill from '../StatusPill';

export interface LeaderboardEntry {
  wallet: string;
  score: number;
  lastCalculated?: string | Date;
  source?: 'manual' | 'hardwareapi';
}

interface EventLeaderboardProps {
  leaderboard: LeaderboardEntry[];
}

function shortenWallet(wallet: string): string {
  if (!wallet || wallet.length <= 12) return wallet || '—';
  return wallet.slice(0, 6) + '…' + wallet.slice(-4);
}

function formatDate(value: string | Date | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

export default function EventLeaderboard({ leaderboard }: EventLeaderboardProps) {
  const sorted = React.useMemo(() => {
    const copy = [...(leaderboard || [])];
    copy.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return copy;
  }, [leaderboard]);

  if (!sorted || sorted.length === 0) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        No leaderboard entries yet.
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-800">
        <thead>
          <tr>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Rank</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Wallet</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Score</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hidden sm:table-cell">Source</th>
            <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 hidden md:table-cell">Updated</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
          {sorted.map((entry, idx) => (
            <tr key={entry.wallet + idx} className="hover:bg-gray-50 dark:hover:bg-gray-900/40 transition">
              <td className="px-3 py-2 text-sm text-gray-700 dark:text-gray-200">{idx + 1}</td>
              <td className="px-3 py-2 text-sm font-mono text-gray-800 dark:text-gray-100">{shortenWallet(entry.wallet)}</td>
              <td className="px-3 py-2 text-sm text-right font-semibold text-gray-900 dark:text-white">{entry.score?.toLocaleString?.() ?? entry.score}</td>
              <td className="px-3 py-2 text-right hidden sm:table-cell">
                <StatusPill
                  label={entry.source || 'manual'}
                  tone={entry.source === 'hardwareapi' ? 'info' : 'neutral'}
                  className="text-[0.65rem] py-0.5 px-2"
                />
              </td>
              <td className="px-3 py-2 text-right text-xs text-gray-500 dark:text-gray-400 hidden md:table-cell">{formatDate(entry.lastCalculated)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
