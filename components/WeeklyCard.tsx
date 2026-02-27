import React from 'react';
import ProgressPill from './ProgressPill';
import StatusPill from './StatusPill'; // shared badge styling for consistent statuses
import { getAssetName, isBoostAssetSupported } from '../lib/utils';

export type WeeklyRewardView = {
  _id: string;
  miner_key: string;
  no: number;
  status: string;
  asset_id: string;
  amount: number;
  txId?: string;
  createdAt: string | Date;
  claimedAt?: string | Date;
  isWeekly: true;
  progressDays: number;
  etaDate: string | Date;
  weekLabel?: string;
  fiatValue?: number;
  // Optional metadata to disambiguate split reward databases.
  reward_db?: 'main' | 'dbrewards';
  reward_id?: string;
};

export default function WeeklyCard({
  item,
  onClaim,
  onBoost
}: {
  item: WeeklyRewardView;
  onClaim: (item: any) => void;
  onBoost: (item: any) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const status = item.status;
  const canClaim = status === 'claimable';
  const canBoost = status === 'pending' && isBoostAssetSupported(item.asset_id);
  const assetName = getAssetName(item.asset_id) || item.asset_id;
  const unlockStr = new Date(item.createdAt).toUTCString().replace(':00 GMT', ' UTC');
  // Use theme-aware button styling for better contrast in both modes.
  const claimBtnClass = canClaim
    ? 'border-emerald-500 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/10'
    : 'border-slate-300 dark:border-slate-700 text-slate-400 cursor-not-allowed';
  const boostBtnClass = canBoost
    ? 'border-rose-500 text-rose-700 dark:text-rose-200 hover:bg-rose-500/10'
    : 'border-slate-300 dark:border-slate-700 text-slate-400 cursor-not-allowed';

  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white/80 text-slate-900 shadow-md shadow-slate-200/60 ring-1 ring-slate-200/60 dark:border-white/10 dark:bg-gray-950/60 dark:text-slate-100 dark:shadow-none transition">
      <div className="flex flex-col gap-3 cursor-pointer px-4 pt-4 sm:px-5 sm:pt-5" onClick={() => setExpanded(e => !e)}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Week of Fri–Thu</div>
            <div className="text-lg font-semibold leading-tight">{item.weekLabel || new Date(item.createdAt).toDateString()}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Unlock: {unlockStr}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Amount</div>
            <div className="text-xl font-bold">{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {assetName}</div>
          </div>
        </div>
        <div className="text-[0.72rem] text-slate-500 dark:text-slate-400">
          Unlock moves this reward into the 30-day pending window; it becomes claimable one day after the bar reaches 30/30 days.
        </div>
      </div>

      {expanded && (
      <div className="px-4 sm:px-5 pb-4">
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <StatusPill
            label={status}
            tone={status === 'pending' ? 'warning' : status === 'claimable' ? 'success' : 'muted'}
            value={status === 'claimable' ? '30/30 ready' : undefined}
            className="text-xs"
          />
          {item.txId && (
            <a href={`https://explorer.perawallet.app/tx/${item.txId}`} target="_blank" rel="noreferrer" className="text-xs text-sky-600 hover:underline dark:text-sky-300">View Tx</a>
          )}
          {status === 'claimed' && item.claimedAt && (
            <span className="text-xs text-slate-500 dark:text-slate-400">Claimed: {new Date(item.claimedAt).toUTCString()}</span>
          )}
        </div>

        {status === 'pending' && (
          <div className="mt-3">
            <ProgressPill progressDays={item.progressDays} etaDate={new Date(item.etaDate)} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors duration-150 ${claimBtnClass}`}
            disabled={!canClaim}
            onClick={() => onClaim(item)}
          >
            Claim
          </button>
          <button
            className={`px-3 py-1.5 rounded-lg border text-sm transition-colors duration-150 ${boostBtnClass}`}
            disabled={!canBoost}
            onClick={() => onBoost(item)}
          >
            Instant Claim (30% Fee)
          </button>
        </div>
      </div>
      )}
    </div>
  );
}
