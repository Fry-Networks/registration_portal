import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from 'react';
import type { Notification } from '../components/NotificationCenter';

type NotificationContextValue = {
  notifications: Notification[];
  setNotifications: (items: Notification[]) => void;
  dismiss: (id: string) => void;
  dismissedIds: string[];
  clear: () => void;
};

const NotificationContext = createContext<NotificationContextValue | undefined>(
  undefined
);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotificationsState] = useState<Notification[]>([]);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);

  const setNotifications = useCallback(
    (items: Notification[]) => {
      setNotificationsState(items.filter((item) => !dismissedIds.includes(item.id)));
    },
    [dismissedIds]
  );

  const dismiss = useCallback((id: string) => {
    setDismissedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setNotificationsState((prev) => prev.filter((notification) => notification.id !== id));
  }, []);

  const clear = useCallback(() => {
    setNotificationsState([]);
  }, []);

  const value = useMemo(
    () => ({ notifications, setNotifications, dismiss, dismissedIds, clear }),
    [notifications, setNotifications, dismiss, dismissedIds, clear]
  );

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
}
