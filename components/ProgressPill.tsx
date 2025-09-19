import React from 'react';

export default function ProgressPill({
  progressDays,
  etaDate
}: {
  progressDays: number;
  etaDate: Date;
}) {
  const pct = Math.min(100, Math.max(0, Math.round((progressDays / 30) * 100)));
  const daysLeft = Math.max(0, 30 - progressDays);
  const etaStr = etaDate ? new Date(etaDate).toDateString() : '';

  return (
    <div className="w-full">
      <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
        <span>{progressDays}/30 days</span>
        <span>{daysLeft}d left • {etaStr}</span>
      </div>
      <div className="w-full h-2 bg-gray-800 rounded">
        <div className="h-2 bg-green-500 rounded" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

