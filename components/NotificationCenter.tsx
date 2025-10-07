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

const variantStyles: Record<Variant, { container: string; icon: typeof InformationCircleIcon; accent: string }> = {
  info: {
    container: 'bg-blue-900/60 text-blue-50',
    icon: InformationCircleIcon,
    accent: 'border-blue-400/80'
  },
  warning: {
    container: 'bg-[#1b1305]/90 text-yellow-50',
    icon: ExclamationIcon,
    accent: 'border-yellow-400/80'
  },
  error: {
    container: 'bg-red-900/70 text-red-50',
    icon: ExclamationIcon,
    accent: 'border-red-400/80'
  },
  success: {
    container: 'bg-green-900/60 text-green-50',
    icon: InformationCircleIcon,
    accent: 'border-green-400/80'
  }
};

export default function NotificationCenter({
  notifications,
  onDismiss
}: {
  notifications: Notification[];
  onDismiss?: (id: string) => void;
}) {
  if (!notifications || notifications.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {notifications.map((notification) => {
        const variant = notification.variant ?? 'info';
        const styles = variantStyles[variant];
        const Icon = styles.icon;
        const publishedAtLabel = notification.publishedAt
          ? new Date(notification.publishedAt).toLocaleString()
          : null;

        return (
          <div
            key={notification.id}
            className={`relative flex w-full items-start gap-4 rounded-2xl border p-5 pr-12 shadow-xl shadow-black/40 break-words backdrop-blur-xl border-[1.5px] ${styles.container} ${styles.accent}`}
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white">
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 pr-2 text-[13px] leading-relaxed text-white/90">
              <div className="flex flex-wrap items-center gap-2 font-semibold text-white tracking-wide">
                <span>{notification.title}</span>
                {notification.source === 'announcement' && (
                  <span className="rounded-full border border-white/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/70">
                    Announcement
                  </span>
                )}
              </div>
              {publishedAtLabel && (
                <div className="mt-1 text-[11px] font-medium uppercase tracking-wide text-white/50">
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
                  className="mt-3 inline-flex items-center gap-1 text-[12px] font-semibold uppercase tracking-wide text-white underline decoration-dotted transition hover:text-white/80"
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
                className="absolute top-4 right-4 rounded-full p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white"
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
