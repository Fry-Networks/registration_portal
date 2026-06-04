import React from 'react';
import ProgressPill from './ProgressPill';
import StatusPill from './StatusPill'; // shared badge styling for consistent statuses
import { getAssetName, isBoostAssetSupported } from '../lib/utils';

export type DailyRewardView = {
  _id: string;
  miner_key: string;
  no: number;
  status: string;
  asset_id: string;
  amount: number;
  txId?: string;
  createdAt: string | Date;
  claimedAt?: string | Date;
  isWeekly: false;
  progressDays: number;
  etaDate: string | Date;
  fiatValue?: number;
};

export default function DailyRow({
  item,
  onClaim,
  onBoost
}: {
  item: DailyRewardView;
  onClaim: (item: any) => void;
  onBoost: (item: any) => void;
}) {
  const [expanded, setExpanded] = React.useState(true);
  const status = item.status;
  const canClaim = status === 'claimable';
  const canBoost = status === 'pending' && isBoostAssetSupported(item.asset_id);
  const assetName = getAssetName(item.asset_id) || item.asset_id;
  // Theme-aware action styling for consistency with weekly cards.
  const claimBtnClass = canClaim
    ? 'border-emerald-500 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/10'
    : 'border-slate-300 dark:border-slate-700 text-slate-400 cursor-not-allowed';
  const boostBtnClass = canBoost
    ? 'border-rose-500 text-rose-700 dark:text-rose-200 hover:bg-rose-500/10'
    : 'border-slate-300 dark:border-slate-700 text-slate-400 cursor-not-allowed';

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/85 text-slate-900 shadow-sm shadow-slate-200/60 ring-1 ring-slate-200/60 dark:border-white/10 dark:bg-gray-950/60 dark:text-slate-100">
      <div className="flex items-center justify-between gap-3 px-4 py-3 cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div className="space-y-1">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Date</div>
          <div className="text-base font-semibold leading-tight">{new Date(item.createdAt).toDateString()}</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">Amount</div>
          <div className="text-lg font-bold">{item.amount} {assetName}</div>
        </div>
      </div>
      {expanded && (
      <div className="px-4 pb-4">
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusPill
            label={status}
            tone={status === 'pending' ? 'warning' : status === 'claimable' ? 'success' : 'muted'}
            className="text-xs"
          />
        {item.txId && (
          <a href={`https://explorer.perawallet.app/tx/${item.txId}`} target="_blank" rel="noreferrer" className="text-xs text-sky-600 hover:underline dark:text-sky-300">View Tx</a>
        )}
        {status === 'claimable' && (
          <span className="text-xs text-emerald-600 dark:text-emerald-300">• Ready to claim •</span>
        )}
        {status === 'claimed' && item.claimedAt && (
          <span className="text-xs text-slate-500 dark:text-slate-400">Claimed: {new Date(item.claimedAt).toUTCString()}</span>
        )}
        </div>
        {/* Close expanded content wrapper */}
      </div>
      )}
      {expanded && status === 'pending' && (
        <div className="mt-2">
          <ProgressPill progressDays={item.progressDays} etaDate={new Date(item.etaDate)} />
        </div>
      )}
      {expanded && (
      <div className="mt-3 flex flex-col sm:flex-row gap-2">
        <button
          className={`px-3 py-1.5 border rounded-lg text-sm transition-colors duration-150 w-full sm:w-auto min-h-[44px] ${claimBtnClass}`}
          disabled={!canClaim}
          onClick={() => onClaim(item)}
        >
          Claim
        </button>
        <button
          className={`px-3 py-1.5 border rounded-lg text-sm transition-colors duration-150 w-full sm:w-auto min-h-[44px] ${boostBtnClass}`}
          disabled={!canBoost}
          onClick={() => onBoost(item)}
        >
          Instant Claim (30% Fee)
        </button>
      </div>
      )}
    </div>
  );
}
