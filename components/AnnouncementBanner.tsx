'use client';

import {
  ExclamationIcon,
  InformationCircleIcon,
  CheckCircleIcon,
  XIcon
} from '@heroicons/react/outline';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from '../app/notificationcontext';
import type { Notification } from './NotificationCenter';
import { useTheme } from 'next-themes';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider';

const VARIANT_THEMES: Record<
  NonNullable<Notification['variant']>,
  {
    gradient: string;
    accent: string;
    icon: typeof InformationCircleIcon;
    chipBg: string;
    chipText: string;
    glow: string;
  }
> = {
  info: {
    gradient: 'from-cyan-500/15 via-pink-500/10 to-cyan-500/15',
    accent: 'from-cyan-400 via-pink-500 to-cyan-300',
    icon: InformationCircleIcon,
    chipBg: 'bg-cyan-500/20 border-cyan-300/40',
    chipText: 'text-cyan-100',
    glow: 'rgba(226,64,255,0.45)'
  },
  warning: {
    gradient: 'from-amber-500/20 via-orange-500/10 to-amber-500/15',
    accent: 'from-amber-400 via-orange-500 to-amber-300',
    icon: ExclamationIcon,
    chipBg: 'bg-amber-500/20 border-amber-300/40',
    chipText: 'text-amber-100',
    glow: 'rgba(251,191,36,0.45)'
  },
  error: {
    gradient: 'from-red-600/30 via-pink-600/20 to-red-600/25',
    accent: 'from-red-500 via-pink-500 to-red-400',
    icon: ExclamationIcon,
    chipBg: 'bg-red-500/20 border-red-300/40',
    chipText: 'text-red-100',
    glow: 'rgba(248,113,113,0.5)'
  },
  success: {
    gradient: 'from-emerald-500/20 via-teal-500/10 to-emerald-500/15',
    accent: 'from-emerald-400 via-teal-500 to-emerald-300',
    icon: CheckCircleIcon,
    chipBg: 'bg-emerald-500/20 border-emerald-300/40',
    chipText: 'text-emerald-100',
    glow: 'rgba(16,185,129,0.45)'
  }
};

export default function AnnouncementBanner() {
  const { bannerAnnouncements, dismissAnnouncementBanner } = useNotifications();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const { activeHoliday } = useSeasonalTheme();
  const isChristmas = activeHoliday?.key === 'christmas';
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [glowActive, setGlowActive] = useState(false);

  const itemsToRender = useMemo(
    () =>
      (bannerAnnouncements ?? []).filter((item) => {
        const title = typeof item.title === 'string' ? item.title.trim() : '';
        const hasTitle = title.length > 0;
        const hasMessage = Boolean(item.message);
        return hasTitle || hasMessage;
      }),
    [bannerAnnouncements]
  );

  useEffect(() => {
    const root = document.documentElement;

    if (!itemsToRender || itemsToRender.length === 0) {
      root.style.setProperty('--announcement-banner-height', '0px');
      return;
    }

    const updateHeight = () => {
      const height = containerRef.current?.offsetHeight ?? 0;
      root.style.setProperty('--announcement-banner-height', `${height}px`);
    };

    updateHeight();

    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => updateHeight());
    observer.observe(el);

    return () => {
      observer.disconnect();
      root.style.setProperty('--announcement-banner-height', '0px');
    };
  }, [itemsToRender]);

  const glowResetKey = useMemo(
    () => itemsToRender.map((item) => `${item.id ?? ''}`).join('|'),
    [itemsToRender]
  );

  useEffect(() => {
    if (!itemsToRender || itemsToRender.length === 0) {
      setGlowActive(false);
      return;
    }

    setGlowActive(true);
    const timer = window.setTimeout(() => setGlowActive(false), 20000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [glowResetKey, itemsToRender]);

  if (!itemsToRender || itemsToRender.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className={`border-b py-4 ${isDark ? 'border-white/5 bg-transparent text-white' : 'border-slate-200/80 bg-white/80 text-slate-900 backdrop-blur'}`}
      style={isChristmas ? { marginTop: '1in' } : undefined}
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 sm:px-8">
        {itemsToRender.map((announcement) => {
          const publishedAtLabel = announcement.publishedAt
            ? new Date(announcement.publishedAt).toLocaleString()
            : null;
          const theme =
            VARIANT_THEMES[announcement.variant ?? 'info'] ??
            VARIANT_THEMES.info;
          const Icon = theme.icon;

          const cardShadow = glowActive
            ? `0 0 25px ${theme.glow}, 0 0 55px ${theme.glow}`
            : '0 25px 60px rgba(0,0,0,0.55)';

          return (
            <div key={announcement.id} className="relative rounded-3xl">
              {glowActive && (
                <div
                  aria-hidden
                  className={`pointer-events-none absolute inset-0 rounded-[1.85rem] opacity-80 blur-[30px] bg-gradient-to-r ${theme.accent}`}
                />
              )}
              <div
                className={`relative rounded-3xl bg-gradient-to-r ${theme.accent} p-[1.25px] transition-shadow duration-700`}
                style={{ boxShadow: cardShadow }}
              >
                <div
                  className={`relative overflow-hidden rounded-[calc(1.5rem-1.25px)] p-5 sm:p-6 backdrop-blur-2xl ${
                    isDark ? 'bg-black/50' : 'bg-white'
                  }`}
                >
                  <div
                    aria-hidden
                    className={`absolute inset-0 opacity-70 bg-gradient-to-r ${theme.gradient} ${isDark ? '' : 'mix-blend-multiply'}`}
                  />
                  <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                    <div
                      className={`flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl border ${
                        isDark
                          ? 'border-white/20 bg-white/10 text-white shadow-[0_0_25px_rgba(255,255,255,0.15)]'
                          : 'border-slate-200 bg-white text-slate-800 shadow-[0_10px_30px_rgba(15,23,42,0.12)]'
                      }`}
                    >
                      <Icon className="h-7 w-7" />
                    </div>
                    <div className="flex-1 text-sm sm:text-base">
                      <div className="flex flex-wrap items-center gap-3">
                        <span className={`text-lg font-semibold tracking-wide sm:text-xl ${isDark ? 'text-white' : 'text-slate-900'}`}>
                          {announcement.title || 'Announcement'}
                        </span>
                        <span
                          className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest ${
                            isDark
                              ? 'border-white/30 bg-white/10 text-white'
                              : 'border-slate-200 bg-slate-100 text-slate-800'
                          }`}
                        >
                          Announcement
                        </span>
                        {publishedAtLabel && (
                          <span className={`text-[11px] font-medium uppercase tracking-wider sm:text-xs ${isDark ? 'text-white/70' : 'text-slate-600'}`}>
                            {publishedAtLabel}
                          </span>
                        )}
                      </div>
                      {announcement.message && (
                        <div className={`mt-3 whitespace-pre-line text-sm leading-relaxed sm:text-base ${isDark ? 'text-white/90' : 'text-slate-800'}`}>
                          {announcement.message}
                        </div>
                      )}
                      {announcement.cta?.href && announcement.cta.label && (
                        <a
                          href={announcement.cta.href}
                          target="_blank"
                          rel="noreferrer"
                          className={`mt-4 inline-flex items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide shadow-lg transition hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:text-sm ${theme.chipBg} ${
                            isDark ? `${theme.chipText} focus-visible:outline-white` : 'text-slate-900 focus-visible:outline-slate-500 bg-white'
                          }`}
                        >
                          {announcement.cta.label}
                        </a>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => dismissAnnouncementBanner(announcement.id)}
                      className={`self-start rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                        isDark
                          ? 'border-white/30 text-white/80 hover:bg-white/10 focus-visible:outline-white'
                          : 'border-slate-200 text-slate-800 hover:bg-slate-100 focus-visible:outline-slate-500'
                      }`}
                    >
                      <span className="inline-flex items-center gap-1">
                        <XIcon className="h-4 w-4" />
                        Dismiss
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
