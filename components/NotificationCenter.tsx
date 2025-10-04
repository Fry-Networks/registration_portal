import { ExclamationIcon, InformationCircleIcon, XIcon } from '@heroicons/react/outline';
import { ReactNode } from 'react';

type Variant = 'info' | 'warning' | 'error' | 'success';

export interface Notification {
  id: string;
  title: string;
  message: ReactNode;
  variant?: Variant;
}

const variantStyles: Record<Variant, { container: string; icon: typeof InformationCircleIcon }> = {
  info: {
    container: 'border-blue-300/60 bg-blue-900/30 text-blue-100',
    icon: InformationCircleIcon
  },
  warning: {
    container: 'border-yellow-300/60 bg-yellow-900/40 text-yellow-100',
    icon: ExclamationIcon
  },
  error: {
    container: 'border-red-300/60 bg-red-900/40 text-red-100',
    icon: ExclamationIcon
  },
  success: {
    container: 'border-green-300/60 bg-green-900/30 text-green-100',
    icon: InformationCircleIcon
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
            className={`flex items-start gap-3 rounded-lg border p-4 shadow-sm ${styles.container}`}
          >
            <Icon className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <div className="flex-1">
              <div className="font-semibold leading-tight text-white">
                {notification.title}
              </div>
              <div className="mt-1 text-sm opacity-90">{notification.message}</div>
            </div>
            {onDismiss && (
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => onDismiss(notification.id)}
                className="rounded-full p-1 text-white/70 transition hover:text-white"
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
