import React from 'react';
import ProgressPill from './ProgressPill';
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
  const claimBtnClass = canClaim ? 'border-green-500 text-green-300 hover:bg-green-600/10' : 'border-gray-700 text-gray-500 cursor-not-allowed';
  const boostBtnClass = canBoost ? 'border-red-600 text-red-300 hover:bg-red-600/10 hover:text-red-200' : 'border-gray-700 text-gray-500 cursor-not-allowed';

  return (
    <div className="border border-gray-800/70 rounded-lg p-4 bg-black/40 backdrop-blur-sm text-gray-300">
      <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpanded(e => !e)}>
        <div>
          <div className="text-sm text-gray-400">Week of Fri–Thu</div>
          <div className="text-lg text-white font-semibold">{item.weekLabel || new Date(item.createdAt).toDateString()}</div>
          <div className="text-xs text-gray-500 mt-1">
            Unlock: {unlockStr}
          </div>
          <div className="text-[0.65rem] text-gray-500 mt-0.5 italic">
            Unlock moves this reward into the 30-day pending window; it becomes claimable one day after the bar reaches 30/30 days.
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-400">Amount</div>
          <div className="text-xl text-white font-bold">{item.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {assetName}</div>
        </div>
      </div>

      {expanded && (
      <div className="mt-3 flex items-center gap-2">
        <span className={`px-2 py-1 text-xs rounded ${status === 'pending' ? 'bg-amber-900/40 text-amber-300' : status === 'claimable' ? 'bg-green-900/40 text-green-300' : 'bg-gray-800 text-gray-400'}`}>
          {status.toUpperCase()}
        </span>
        {item.txId && (
          <a href={`https://explorer.perawallet.app/tx/${item.txId}`} target="_blank" rel="noreferrer" className="text-xs text-blue-400 hover:underline">View Tx</a>
        )}
        {status === 'claimable' && (
          <span className="text-xs text-green-300">30/30 • Ready to claim</span>
        )}
        {status === 'claimed' && item.claimedAt && (
          <span className="text-xs text-gray-400">Claimed: {new Date(item.claimedAt).toUTCString()}</span>
        )}
      </div>
      )}

      {expanded && status === 'pending' && (
        <div className="mt-3">
          <ProgressPill progressDays={item.progressDays} etaDate={new Date(item.etaDate)} />
        </div>
      )}

      {expanded && (
      <div className="mt-4 flex gap-2">
        <button
          className={`px-3 py-1 border rounded transition-colors duration-150 ${claimBtnClass}`}
          disabled={!canClaim}
          onClick={() => onClaim(item)}
        >
          Claim
        </button>
        <button
          className={`px-3 py-1 border rounded transition-colors duration-150 ${boostBtnClass}`}
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
