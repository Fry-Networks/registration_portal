'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MoonIcon, SparklesIcon, SunIcon } from '@heroicons/react/outline';
import { useTheme } from 'next-themes';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider';

function classNames(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

const ThemeControls = () => {
  const { resolvedTheme, setTheme } = useTheme();
  const {
    seasonalEnabled,
    setSeasonalEnabled,
    activeHoliday,
    availableHoliday,
    envForceOff,
    envForcedKey,
    autoDisabled,
    displayName
  } = useSeasonalTheme();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const baseIsDark = resolvedTheme === 'dark';
  const seasonalActive = seasonalEnabled && !!activeHoliday;
  const holidayCandidate = activeHoliday ?? availableHoliday;
  const seasonalDisabledByEnv = envForceOff;

  const seasonalTooltip = useMemo(() => {
    if (envForceOff) return 'Seasonal themes are disabled by environment config';
    if (envForcedKey) return `Forced to ${displayName ?? envForcedKey}`;
    if (autoDisabled) return 'Automatic seasonal themes are disabled by environment config';
    return seasonalEnabled ? 'Turn off seasonal theme accents' : 'Turn on seasonal theme accents';
  }, [autoDisabled, displayName, envForceOff, envForcedKey, seasonalEnabled]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const MainIcon = seasonalActive ? SparklesIcon : baseIsDark ? SunIcon : MoonIcon;

  const triggerClass = baseIsDark
    ? 'flex h-11 w-11 items-center justify-center rounded-full border border-red-500/60 bg-red-500/15 text-red-100 shadow-md backdrop-blur transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/80'
    : 'flex h-11 w-11 items-center justify-center rounded-full border border-red-400 bg-red-50 text-red-700 shadow-sm transition hover:bg-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-300';

  const dropdownClass = baseIsDark
    ? 'absolute left-0 z-50 mt-2 w-48 max-w-[calc(100vw-1rem)] origin-top-left overflow-hidden rounded-2xl border border-red-500/40 bg-[#0b0b0f]/95 shadow-xl shadow-red-900/40 sm:left-auto sm:right-0 sm:origin-top-right'
    : 'absolute left-0 z-50 mt-2 w-48 max-w-[calc(100vw-1rem)] origin-top-left overflow-hidden rounded-2xl border border-red-300/60 bg-white/95 shadow-xl shadow-red-200 sm:left-auto sm:right-0 sm:origin-top-right';
  const isLightActive = !baseIsDark && !seasonalActive;
  const isDarkActive = baseIsDark && !seasonalActive;

  if (!mounted) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label="Theme controls"
        title={
          seasonalActive
            ? `${displayName ?? activeHoliday?.name} theme`
            : baseIsDark
            ? 'Dark mode'
            : 'Light mode'
        }
        onClick={() => setOpen((prev) => !prev)}
        className={classNames(
          triggerClass,
          open ? (baseIsDark ? 'bg-red-500/25' : 'bg-red-100') : ''
        )}
      >
        <MainIcon className="h-5 w-5" />
      </button>

      {open && (
        <div className={dropdownClass}>
          <div className="p-1">
            <button
              type="button"
              onClick={() => {
                setTheme('light');
                setOpen(false);
              }}
              className={classNames(
                'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2',
                baseIsDark
                  ? 'text-red-100 hover:bg-red-500/15 focus-visible:ring-red-400/80'
                  : 'text-red-800 hover:bg-red-100 focus-visible:ring-red-300',
                isLightActive ? (baseIsDark ? 'bg-red-500/10' : 'bg-red-100') : ''
              )}
            >
              <SunIcon className="h-4 w-4" />
              Light mode
            </button>
            <button
              type="button"
              onClick={() => {
                setTheme('dark');
                setOpen(false);
              }}
              className={classNames(
                'mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2',
                baseIsDark
                  ? 'text-red-100 hover:bg-red-500/15 focus-visible:ring-red-400/80'
                  : 'text-red-800 hover:bg-red-100 focus-visible:ring-red-300',
                isDarkActive ? (baseIsDark ? 'bg-red-500/10' : 'bg-red-100') : ''
              )}
            >
              <MoonIcon className="h-4 w-4" />
              Dark mode
            </button>
            {holidayCandidate && (
              <button
                type="button"
                onClick={() => {
                  if (seasonalDisabledByEnv) return;
                  setSeasonalEnabled(!seasonalEnabled);
                  setOpen(false);
                }}
                disabled={seasonalDisabledByEnv}
                title={seasonalTooltip}
                className={classNames(
                  'mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition focus:outline-none focus-visible:ring-2',
                  baseIsDark
                    ? seasonalActive
                      ? 'bg-red-500/15 text-red-50'
                      : 'text-red-200 hover:bg-red-500/15'
                    : seasonalActive
                    ? 'bg-red-100 text-red-800'
                    : 'text-red-800 hover:bg-red-100',
                  seasonalDisabledByEnv ? 'cursor-not-allowed opacity-60' : '',
                  baseIsDark ? 'focus-visible:ring-red-400/80' : 'focus-visible:ring-red-300'
                )}
              >
                <SparklesIcon className="h-4 w-4" />
                {seasonalActive ? `Disable ${displayName ?? 'holiday'}` : `Enable ${displayName ?? 'holiday'}`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ThemeControls;
