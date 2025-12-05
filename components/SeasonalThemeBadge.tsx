'use client';

import { SparklesIcon } from '@heroicons/react/outline';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider';

type SeasonalThemeBadgeProps = {
  className?: string;
};

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const SeasonalThemeBadge = ({ className }: SeasonalThemeBadgeProps) => {
  const { activeHoliday, seasonalEnabled, displayName } = useSeasonalTheme();

  if (!seasonalEnabled || !activeHoliday) {
    return null;
  }

  const forced = activeHoliday.source === 'forced';

  return (
    <div
      className={classNames(
        'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-semibold shadow-sm backdrop-blur',
        className
      )}
      style={{
        backgroundColor: 'var(--accent-soft)',
        borderColor: 'var(--accent-strong)',
        color: 'var(--text)'
      }}
    >
      <SparklesIcon className="h-4 w-4" aria-hidden="true" />
      <span>{displayName ?? activeHoliday.name} theme active</span>
      {forced && (
        <span
          className="rounded-full border px-2 py-0.5 text-xs font-semibold"
          style={{ borderColor: 'var(--accent-strong)', color: 'var(--accent-strong)' }}
        >
          Forced
        </span>
      )}
    </div>
  );
};

export default SeasonalThemeBadge;
