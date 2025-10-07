'use client';

import { ExclamationIcon, XIcon } from '@heroicons/react/outline';
import { useEffect, useMemo, useRef } from 'react';
import { useNotifications } from '../app/notificationcontext';

export default function AnnouncementBanner() {
  const { bannerAnnouncements, dismissAnnouncementBanner } = useNotifications();
  const containerRef = useRef<HTMLDivElement | null>(null);

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

  if (!itemsToRender || itemsToRender.length === 0) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="border-b border-white/5 bg-gradient-to-r from-[#7a0211] via-[#c90f2e] to-[#7a0211] py-4 text-white shadow-[0_10px_40px_rgba(201,15,46,0.35)]"
    >
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 sm:px-8">
        {itemsToRender.map((announcement) => {
          const publishedAtLabel = announcement.publishedAt
            ? new Date(announcement.publishedAt).toLocaleString()
            : null;

          return (
            <div
              key={announcement.id}
              className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/20 p-5 shadow-lg shadow-black/30 sm:p-6"
            >
              <div className="absolute -right-16 -top-16 h-40 w-40 rounded-full bg-white/5 blur-3xl" aria-hidden />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-6">
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15 text-white">
                  <ExclamationIcon className="h-9 w-9" />
                </div>
                <div className="flex-1 text-sm sm:text-base">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-lg font-semibold tracking-wide sm:text-xl">
                      {announcement.title || 'Announcement'}
                    </span>
                    <span className="rounded-full border border-white/30 bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-widest">
                      Announcement
                    </span>
                    {publishedAtLabel && (
                      <span className="text-[11px] font-medium uppercase tracking-wider text-white/70 sm:text-xs">
                        {publishedAtLabel}
                      </span>
                    )}
                  </div>
                  {announcement.message && (
                    <div className="mt-3 whitespace-pre-line text-sm leading-relaxed text-white/90 sm:text-base">
                      {announcement.message}
                    </div>
                  )}
                  {announcement.cta?.href && announcement.cta.label && (
                    <a
                      href={announcement.cta.href}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center justify-center rounded-full bg-white px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[#7a0211] shadow-lg transition hover:scale-[1.03] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:text-sm"
                    >
                      {announcement.cta.label}
                    </a>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => dismissAnnouncementBanner(announcement.id)}
                  className="self-start rounded-full border border-white/30 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white/80 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  <span className="inline-flex items-center gap-1">
                    <XIcon className="h-4 w-4" />
                    Dismiss
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
