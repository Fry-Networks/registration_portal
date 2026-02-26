export type SeasonalThemeKey = 'christmas' | 'valentines' | 'easter' | 'july4' | 'thanksgiving';

export type HolidayMatch = {
  key: SeasonalThemeKey;
  name: string;
  holidayDate: Date;
  windowStart: Date;
  windowEnd: Date;
  source: 'auto' | 'forced';
};

type HolidayConfig = {
  key: SeasonalThemeKey;
  name: string;
  computeDate: (year: number) => Date;
};

const HOLIDAYS: HolidayConfig[] = [
  {
    key: 'christmas',
    name: 'Christmas',
    computeDate: (year: number) => new Date(Date.UTC(year, 11, 25, 0, 0, 0, 0))
  },
  {
    key: 'valentines',
    name: "Valentine's Day",
    computeDate: (year: number) => new Date(Date.UTC(year, 1, 14, 0, 0, 0, 0))
  },
  {
    key: 'easter',
    name: 'Easter',
    computeDate: (year: number) => computeEasterUtc(year)
  },
  {
    key: 'july4',
    name: '4th of July',
    computeDate: (year: number) => new Date(Date.UTC(year, 6, 4, 0, 0, 0, 0))
  },
  {
    key: 'thanksgiving',
    name: 'Thanksgiving',
    computeDate: (year: number) => computeThanksgivingUtc(year)
  }
];

export const HOLIDAY_DISPLAY_NAMES: Record<SeasonalThemeKey, string> = HOLIDAYS.reduce(
  (acc, holiday) => {
    acc[holiday.key] = holiday.name;
    return acc;
  },
  {} as Record<SeasonalThemeKey, string>
);

function computeEasterUtc(year: number): Date {
  // Anonymous Gregorian algorithm.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function computeThanksgivingUtc(year: number): Date {
  // Fourth Thursday in November.
  const firstDay = new Date(Date.UTC(year, 10, 1, 0, 0, 0, 0));
  const dayOfWeek = firstDay.getUTCDay(); // 0 = Sunday ... 4 = Thursday
  const offsetToThursday = (4 - dayOfWeek + 7) % 7;
  const thanksgivingDate = 1 + offsetToThursday + 21; // fourth Thursday
  return new Date(Date.UTC(year, 10, thanksgivingDate, 0, 0, 0, 0));
}

function addMonthsUtc(date: Date, months: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + months);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

function addDaysUtc(date: Date, days: number): Date {
  const copy = new Date(date.getTime());
  copy.setUTCDate(copy.getUTCDate() + days);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
}

export function getHolidayWindow(key: SeasonalThemeKey, year: number) {
  const config = HOLIDAYS.find((h) => h.key === key);
  if (!config) {
    throw new Error(`Unknown holiday key: ${key}`);
  }
  const holidayDate = config.computeDate(year);
  const windowStart = addMonthsUtc(holidayDate, -1);
  // Christmas theme stops after Dec 26 (exclusive of Dec 27) to avoid overstaying.
  const windowEnd = key === 'christmas' ? addDaysUtc(holidayDate, 2) : addDaysUtc(holidayDate, 1);
  return {
    holidayDate,
    windowStart,
    windowEnd
  };
}

export type ForcedThemeValue = SeasonalThemeKey | 'off' | null;

export function parseForcedTheme(raw?: string | null): ForcedThemeValue {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (value === 'off' || value === 'none' || value === 'disable' || value === 'disabled') {
    return 'off';
  }
  const match = HOLIDAYS.find((h) => h.key === value);
  return match ? match.key : null;
}

export function getActiveHolidayForDate(
  date: Date,
  options?: { forcedKey?: ForcedThemeValue; disableAuto?: boolean }
): HolidayMatch | null {
  const { forcedKey, disableAuto } = options ?? {};
  const isWithinWindow = (target: HolidayMatch | null) =>
    target ? date.getTime() >= target.windowStart.getTime() && date.getTime() < target.windowEnd.getTime() : false;

  // Helper: check current + previous year windows to handle holiday windows that cross year boundaries.
  const buildWindowMatch = (key: SeasonalThemeKey): HolidayMatch | null => {
    const current = (() => {
      const { holidayDate, windowStart, windowEnd } = getHolidayWindow(key, date.getUTCFullYear());
      return { key, name: HOLIDAYS.find((h) => h.key === key)?.name ?? key, holidayDate, windowStart, windowEnd, source: 'auto' as const };
    })();
    if (isWithinWindow(current)) return current;

    const prev = (() => {
      const { holidayDate, windowStart, windowEnd } = getHolidayWindow(key, date.getUTCFullYear() - 1);
      return { key, name: HOLIDAYS.find((h) => h.key === key)?.name ?? key, holidayDate, windowStart, windowEnd, source: 'auto' as const };
    })();
    if (isWithinWindow(prev)) return prev;
    return null;
  };

  if (forcedKey === 'off') {
    return null;
  }
  if (forcedKey) {
    // Respect holiday windows even when forced so we don't show Christmas year-round.
    const forcedMatch = buildWindowMatch(forcedKey as SeasonalThemeKey);
    if (!forcedMatch) return null;
    return { ...forcedMatch, source: 'forced' };
  }

  if (disableAuto) {
    return null;
  }

  for (const holiday of HOLIDAYS) {
    const match = buildWindowMatch(holiday.key);
    if (match) {
      return match;
    }
  }

  return null;
}

// Extended greeting window: one month before Christmas through Jan 2 (exclusive Jan 3).
function getChristmasGreetingWindow(year: number) {
  const { holidayDate, windowStart } = getHolidayWindow('christmas', year);
  const greetingWindowEnd = addDaysUtc(holidayDate, 8); // Dec 25 + 8 days = Jan 2 (exclusive Jan 3)
  return { windowStart, windowEnd: greetingWindowEnd };
}

export function isWithinChristmasGreetingWindow(date: Date): boolean {
  const current = getChristmasGreetingWindow(date.getUTCFullYear());
  const prior = getChristmasGreetingWindow(date.getUTCFullYear() - 1);
  const ts = date.getTime();
  return (
    (ts >= current.windowStart.getTime() && ts < current.windowEnd.getTime()) ||
    (ts >= prior.windowStart.getTime() && ts < prior.windowEnd.getTime())
  );
}

export function nextMidnightDelayMs(now: Date): number {
  const next = new Date(now.getTime());
  next.setHours(24, 0, 0, 500);
  return Math.max(60_000, next.getTime() - now.getTime());
}
