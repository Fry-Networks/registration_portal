import React from 'react';
import Tooltip from './Tooltip';

// Lightweight, theme-friendly pill used across history/rewards surfaces.
// Keeps badge styling consistent between weekly/daily cards and summary chips.
type StatusPillProps = {
  label: string;
  value?: React.ReactNode;
  tone?: 'neutral' | 'info' | 'success' | 'warning' | 'muted';
  tooltip?: string;
  icon?: React.ReactNode;
  className?: string;
};

const toneClasses: Record<NonNullable<StatusPillProps['tone']>, string> = {
  neutral: 'border-slate-500/50 bg-slate-500/10 text-slate-900 dark:text-slate-100',
  info: 'border-sky-500/60 bg-sky-500/10 text-sky-900 dark:text-sky-100',
  success: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-900 dark:text-emerald-100',
  warning: 'border-amber-500/60 bg-amber-500/10 text-amber-900 dark:text-amber-100',
  muted: 'border-slate-600/50 bg-slate-600/10 text-slate-700 dark:text-slate-200'
};

export default function StatusPill({
  label,
  value,
  tone = 'neutral',
  tooltip,
  icon,
  className = ''
}: StatusPillProps) {
  const content = (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.75rem] font-semibold leading-tight ${toneClasses[tone]} ${className}`}
    >
      {icon && <span className="h-4 w-4">{icon}</span>}
      <span className="uppercase tracking-[0.08em] text-[0.7rem]">{label}</span>
      {value !== undefined && (
        <span className="text-sm font-semibold normal-case">{value}</span>
      )}
    </span>
  );

  if (!tooltip) return content;
  return <Tooltip text={tooltip}>{content}</Tooltip>;
}
