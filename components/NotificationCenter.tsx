import { ExclamationIcon, InformationCircleIcon, XIcon } from '@heroicons/react/outline';
import { ReactNode } from 'react';

type Variant = 'info' | 'warning' | 'error' | 'success';

export interface Notification {
  id: string;
  title: string;
  message: ReactNode;
  variant?: Variant;
  source?: 'device' | 'announcement';
  priority?: number;
  publishedAt?: string;
  cta?: {
    label: string;
    href: string;
  };
}

type StyleConfig = {
  container: string;
  icon: typeof InformationCircleIcon;
  border: string;
  iconBg: string;
  title: string;
  meta: string;
  body: string;
  cta: string;
  badge: string;
  dismiss: string;
  shadow: string;
};

const variantStylesDark: Record<Variant, StyleConfig> = {
  info: {
    container: 'bg-blue-900/60 text-blue-50',
    icon: InformationCircleIcon,
    border: 'border-blue-400/80',
    iconBg: 'border-white/20 bg-white/10 text-white',
    title: 'text-white',
    meta: 'text-white/50',
    body: 'text-white/90',
    cta: 'text-white underline decoration-dotted hover:text-white/80',
    badge: 'border-white/20 bg-white/10 text-white/70',
    dismiss: 'text-white/70 hover:bg-white/15 hover:text-white focus-visible:outline-white',
    shadow: 'shadow-xl shadow-black/40'
  },
  warning: {
    container: 'bg-[#1b1305]/90 text-yellow-50',
    icon: ExclamationIcon,
    border: 'border-yellow-400/80',
    iconBg: 'border-white/20 bg-white/10 text-white',
    title: 'text-white',
    meta: 'text-white/50',
    body: 'text-white/90',
    cta: 'text-white underline decoration-dotted hover:text-white/80',
    badge: 'border-white/20 bg-white/10 text-white/70',
    dismiss: 'text-white/70 hover:bg-white/15 hover:text-white focus-visible:outline-white',
    shadow: 'shadow-xl shadow-black/40'
  },
  error: {
    container: 'bg-red-900/70 text-red-50',
    icon: ExclamationIcon,
    border: 'border-red-400/80',
    iconBg: 'border-white/20 bg-white/10 text-white',
    title: 'text-white',
    meta: 'text-white/50',
    body: 'text-white/90',
    cta: 'text-white underline decoration-dotted hover:text-white/80',
    badge: 'border-white/20 bg-white/10 text-white/70',
    dismiss: 'text-white/70 hover:bg-white/15 hover:text-white focus-visible:outline-white',
    shadow: 'shadow-xl shadow-black/40'
  },
  success: {
    container: 'bg-green-900/60 text-green-50',
    icon: InformationCircleIcon,
    border: 'border-green-400/80',
    iconBg: 'border-white/20 bg-white/10 text-white',
    title: 'text-white',
    meta: 'text-white/50',
    body: 'text-white/90',
    cta: 'text-white underline decoration-dotted hover:text-white/80',
    badge: 'border-white/20 bg-white/10 text-white/70',
    dismiss: 'text-white/70 hover:bg-white/15 hover:text-white focus-visible:outline-white',
    shadow: 'shadow-xl shadow-black/40'
  }
};

const variantStylesLight: Record<Variant, StyleConfig> = {
  info: {
    container: 'bg-white text-slate-900',
    icon: InformationCircleIcon,
    border: 'border-slate-200',
    iconBg: 'border-slate-200 bg-slate-100 text-slate-800',
    title: 'text-slate-900',
    meta: 'text-slate-500',
    body: 'text-slate-800',
    cta: 'text-slate-900 underline decoration-dotted hover:text-slate-700',
    badge: 'border-slate-200 bg-slate-100 text-slate-700',
    dismiss: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-slate-500',
    shadow: 'shadow-lg shadow-slate-200/70'
  },
  warning: {
    container: 'bg-amber-50 text-amber-900',
    icon: ExclamationIcon,
    border: 'border-amber-200',
    iconBg: 'border-amber-200 bg-amber-100 text-amber-800',
    title: 'text-amber-900',
    meta: 'text-amber-700',
    body: 'text-amber-900',
    cta: 'text-amber-900 underline decoration-dotted hover:text-amber-800',
    badge: 'border-amber-200 bg-amber-100 text-amber-800',
    dismiss: 'text-amber-800 hover:bg-amber-100 hover:text-amber-900 focus-visible:outline-amber-500',
    shadow: 'shadow-lg shadow-amber-200/70'
  },
  error: {
    container: 'bg-red-50 text-red-900',
    icon: ExclamationIcon,
    border: 'border-red-200',
    iconBg: 'border-red-200 bg-red-100 text-red-800',
    title: 'text-red-900',
    meta: 'text-red-700',
    body: 'text-red-900',
    cta: 'text-red-900 underline decoration-dotted hover:text-red-800',
    badge: 'border-red-200 bg-red-100 text-red-800',
    dismiss: 'text-red-800 hover:bg-red-100 hover:text-red-900 focus-visible:outline-red-500',
    shadow: 'shadow-lg shadow-red-200/70'
  },
  success: {
    container: 'bg-emerald-50 text-emerald-900',
    icon: InformationCircleIcon,
    border: 'border-emerald-200',
    iconBg: 'border-emerald-200 bg-emerald-100 text-emerald-800',
    title: 'text-emerald-900',
    meta: 'text-emerald-700',
    body: 'text-emerald-900',
    cta: 'text-emerald-900 underline decoration-dotted hover:text-emerald-800',
    badge: 'border-emerald-200 bg-emerald-100 text-emerald-800',
    dismiss: 'text-emerald-800 hover:bg-emerald-100 hover:text-emerald-900 focus-visible:outline-emerald-500',
    shadow: 'shadow-lg shadow-emerald-200/70'
  }
};

export default function NotificationCenter({
  notifications,
  onDismiss,
  isDark = false
}: {
  notifications: Notification[];
  onDismiss?: (id: string) => void;
  isDark?: boolean;
}) {
  if (!notifications || notifications.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {notifications.map((notification) => {
        const variant = notification.variant ?? 'info';
        const styles = (isDark ? variantStylesDark : variantStylesLight)[variant];
        const Icon = styles.icon;
        const publishedAtLabel = notification.publishedAt
          ? new Date(notification.publishedAt).toLocaleString()
          : null;

        return (
          <div
            key={notification.id}
            className={`relative flex w-full items-start gap-4 rounded-2xl border p-5 pr-12 break-words backdrop-blur-xl border-[1.5px] ${styles.container} ${styles.border} ${styles.shadow}`}
          >
            <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full ${styles.iconBg}`}>
              <Icon className="h-5 w-5" />
            </div>
            <div className={`flex-1 pr-2 text-[13px] leading-relaxed ${styles.body}`}>
              <div className={`flex flex-wrap items-center gap-2 font-semibold tracking-wide ${styles.title}`}>
                <span>{notification.title}</span>
                {notification.source === 'announcement' && (
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${styles.badge}`}>
                    Announcement
                  </span>
                )}
              </div>
              {publishedAtLabel && (
                <div className={`mt-1 text-[11px] font-medium uppercase tracking-wide ${styles.meta}`}>
                  {publishedAtLabel}
                </div>
              )}
              <div className="mt-2 whitespace-pre-wrap break-words">
                {notification.message}
              </div>
              {notification.cta?.href && notification.cta.label && (
                <a
                  href={notification.cta.href}
                  target="_blank"
                  rel="noreferrer"
                  className={`mt-3 inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide transition ${styles.cta}`}
                >
                  {notification.cta.label}
                </a>
              )}
            </div>
            {onDismiss && (
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => onDismiss(notification.id)}
                className={`absolute top-4 right-4 rounded-full p-1.5 transition ${styles.dismiss}`}
              >
                <XIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
