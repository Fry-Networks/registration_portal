import { ExclamationIcon, InformationCircleIcon, XIcon } from '@heroicons/react/outline';
import { ReactNode } from 'react';

type Variant = 'info' | 'warning' | 'error' | 'success';

export interface Notification {
  id: string;
  title: string;
  message: ReactNode;
  variant?: Variant;
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

        return (
          <div
            key={notification.id}
            className={`flex w-full items-start gap-4 rounded-2xl border p-5 shadow-xl shadow-black/40 break-words backdrop-blur-xl border-[1.5px] ${styles.container} ${styles.accent}`}
          >
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white">
              <Icon className="h-5 w-5" />
            </div>
            <div className="flex-1 text-[13px] leading-relaxed text-white/90">
              <div className="font-semibold text-white tracking-wide">
                {notification.title}
              </div>
              <div className="mt-2 whitespace-pre-wrap break-words">
                {notification.message}
              </div>
            </div>
            {onDismiss && (
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => onDismiss(notification.id)}
                className="ml-2 rounded-full p-1.5 text-white/70 transition hover:bg-white/15 hover:text-white"
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
