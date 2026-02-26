'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import {
  getActiveHolidayForDate,
  HOLIDAY_DISPLAY_NAMES,
  nextMidnightDelayMs,
  parseForcedTheme,
  type ForcedThemeValue,
  type HolidayMatch,
  type SeasonalThemeKey
} from '../../lib/holidays';

type SeasonalThemeContextValue = {
  activeHoliday: HolidayMatch | null;
  availableHoliday: HolidayMatch | null;
  seasonalEnabled: boolean;
  setSeasonalEnabled: (enabled: boolean) => void;
  envForcedKey: SeasonalThemeKey | null;
  envForceOff: boolean;
  autoDisabled: boolean;
};

const SeasonalThemeContext = createContext<SeasonalThemeContextValue | undefined>(undefined);

const STORAGE_KEY = 'seasonal-theme-enabled';
const envForced = parseForcedTheme(process.env.NEXT_PUBLIC_FORCE_SEASONAL_THEME);
const envForceOff = envForced === 'off';
const envForcedKey: SeasonalThemeKey | null = envForced && envForced !== 'off' ? envForced : null;
const envDisableAuto =
  envForceOff ||
  (process.env.NEXT_PUBLIC_DISABLE_SEASONAL_AUTO ?? '')
    .toString()
    .toLowerCase()
    .trim() === 'true';
// Version the toggle key by forced holiday so a forced rollout (e.g., Christmas) defaults on even if users disabled a prior season.
const STORAGE_KEY_EFFECTIVE = envForcedKey ? `${STORAGE_KEY}-${envForcedKey}` : STORAGE_KEY;

function applyHolidayDataAttribute(key: SeasonalThemeKey | null) {
  if (typeof document === 'undefined') return;
  if (key) {
    document.documentElement.setAttribute('data-holiday-theme', key);
  } else {
    document.documentElement.removeAttribute('data-holiday-theme');
  }
}

export function SeasonalThemeProvider({ children }: { children: ReactNode }) {
  const [seasonalEnabled, setSeasonalEnabled] = useState(true);
  const [activeHoliday, setActiveHoliday] = useState<HolidayMatch | null>(null);
  const [availableHoliday, setAvailableHoliday] = useState<HolidayMatch | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY_EFFECTIVE);
    if (stored === 'false') {
      setSeasonalEnabled(false);
    }
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !mounted) return;
    window.localStorage.setItem(STORAGE_KEY_EFFECTIVE, seasonalEnabled ? 'true' : 'false');
  }, [seasonalEnabled, mounted]);

  const resolveHoliday = useCallback(() => {
    if (!mounted) return;
    const now = new Date();
    const candidate = getActiveHolidayForDate(now, {
      forcedKey: envForcedKey ?? undefined,
      disableAuto: envDisableAuto
    });
    setAvailableHoliday(candidate);
    if (!seasonalEnabled || envForceOff) {
      setActiveHoliday(null);
      applyHolidayDataAttribute(null);
      return;
    }

    setActiveHoliday(candidate);
    applyHolidayDataAttribute(candidate?.key ?? null);
  }, [mounted, seasonalEnabled]);

  useEffect(() => {
    resolveHoliday();
    if (typeof window === 'undefined') return;
    const delay = nextMidnightDelayMs(new Date());
    const id = window.setTimeout(resolveHoliday, delay);
    return () => {
      window.clearTimeout(id);
    };
  }, [resolveHoliday]);

  useEffect(() => {
    return () => applyHolidayDataAttribute(null);
  }, []);

  const value = useMemo(
    () => ({
      activeHoliday,
      availableHoliday,
      seasonalEnabled,
      setSeasonalEnabled,
      envForcedKey,
      envForceOff,
      autoDisabled: envDisableAuto
    }),
    [activeHoliday, availableHoliday, seasonalEnabled]
  );

  return <SeasonalThemeContext.Provider value={value}>{children}</SeasonalThemeContext.Provider>;
}

export function useSeasonalTheme() {
  const ctx = useContext(SeasonalThemeContext);
  if (!ctx) {
    throw new Error('useSeasonalTheme must be used within a SeasonalThemeProvider');
  }
  const displayName =
    (ctx.activeHoliday ? HOLIDAY_DISPLAY_NAMES[ctx.activeHoliday.key] : null) ??
    (ctx.availableHoliday ? HOLIDAY_DISPLAY_NAMES[ctx.availableHoliday.key] : null) ??
    null;
  return { ...ctx, displayName };
}

export default SeasonalThemeProvider;
