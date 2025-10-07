import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useSession } from 'next-auth/react';
import type { Notification } from '../components/NotificationCenter';

type NotificationSource = 'device' | 'announcement';

type AnnouncementApiResponse = {
  announcements?: Array<{
    id: string;
    title: string;
    body: string;
    variant?: Notification['variant'];
    priority?: number;
    publishedAt?: string;
    expiresAt?: string;
    cta?: {
      label: string;
      href: string;
    };
  }>;
  dismissedAnnouncementIds?: string[];
};

type NotificationContextValue = {
  notifications: Notification[];
  announcements: Notification[];
  bannerAnnouncements: Notification[];
  setNotifications: (items: Notification[]) => void;
  setAnnouncements: (items: Notification[]) => void;
  dismiss: (id: string) => void;
  dismissAnnouncementBanner: (id: string) => Promise<void>;
  refreshAnnouncements: () => Promise<void>;
  dismissedIds: string[];
  clear: () => void;
};

const NotificationContext = createContext<NotificationContextValue | undefined>(
  undefined
);

function createDefaultSources(): Record<NotificationSource, Notification[]> {
  return {
    device: [],
    announcement: []
  };
}

function mergeIds(current: string[], incoming: string[] | undefined) {
  if (!incoming || incoming.length === 0) {
    return current;
  }
  const set = new Set(current);
  let changed = false;
  for (const id of incoming) {
    if (!set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  return changed ? Array.from(set) : current;
}

export function NotificationProvider({
  children,
  isEnabled = true
}: {
  children: ReactNode;
  isEnabled?: boolean;
}) {
  const { status } = useSession();
  const isAuthenticated = status === 'authenticated';
  const shouldOperate = isEnabled && isAuthenticated;

  const [notificationsBySource, setNotificationsBySource] = useState<
    Record<NotificationSource, Notification[]>
  >(createDefaultSources);
  const [dismissedIds, setDismissedIds] = useState<string[]>([]);
  const [bannerDismissedIds, setBannerDismissedIds] = useState<string[]>([]);
  const [acknowledgedAnnouncementIds, setAcknowledgedAnnouncementIds] = useState<string[]>([]);

  const dismissedIdSet = useMemo(() => new Set(dismissedIds), [dismissedIds]);
  const bannerDismissedIdSet = useMemo(
    () => new Set(bannerDismissedIds),
    [bannerDismissedIds]
  );

  const setSourceNotifications = useCallback(
    (source: NotificationSource, items: Notification[]) => {
      setNotificationsBySource((prev) => {
        const filtered = items.filter((item) => !dismissedIdSet.has(item.id));
        const current = prev[source] ?? [];
        if (current.length === filtered.length) {
          const same = current.every((item, index) => item.id === filtered[index]?.id);
          if (same) {
            return prev;
          }
        }
        return {
          ...prev,
          [source]: filtered
        };
      });
    },
    [dismissedIdSet]
  );

  const setNotifications = useCallback(
    (items: Notification[]) => {
      setSourceNotifications('device', items);
    },
    [setSourceNotifications]
  );

  const setAnnouncements = useCallback(
    (items: Notification[]) => {
      setSourceNotifications('announcement', items);
    },
    [setSourceNotifications]
  );

  const recordAnnouncementAcknowledgement = useCallback(
    async (id: string) => {
      if (!id || !shouldOperate) {
        return;
      }

      let alreadyAcknowledged = false;
      setAcknowledgedAnnouncementIds((prev) => {
        if (prev.includes(id)) {
          alreadyAcknowledged = true;
          return prev;
        }
        return [...prev, id];
      });

      if (alreadyAcknowledged) {
        return;
      }

      try {
        const response = await fetch('/api/announcements/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ announcementId: id })
        });
        if (!response.ok) {
          throw new Error(`Request failed with status ${response.status}`);
        }
      } catch (error) {
        console.error('Failed to record announcement dismissal', error);
      }
    },
    [shouldOperate]
  );

  const dismiss = useCallback(
    (id: string) => {
      if (!id) return;
      setDismissedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      let removedFromAnnouncements = false;
      setNotificationsBySource((prev) => {
        const next = createDefaultSources();
        (Object.keys(prev) as NotificationSource[]).forEach((source) => {
          const filtered = prev[source]?.filter((notification) => notification.id !== id) ?? [];
          if (source === 'announcement' && filtered.length !== (prev[source]?.length ?? 0)) {
            removedFromAnnouncements = true;
          }
          next[source] = filtered;
        });
        return next;
      });

      if (removedFromAnnouncements) {
        void recordAnnouncementAcknowledgement(id);
      }
    },
    [recordAnnouncementAcknowledgement]
  );

  const clear = useCallback(() => {
    setNotificationsBySource(createDefaultSources());
  }, []);

  const refreshAnnouncementsRef = useRef<() => Promise<void>>();

  const refreshAnnouncements = useCallback(async () => {
    if (!shouldOperate) {
      setAnnouncements([]);
      setBannerDismissedIds([]);
      setAcknowledgedAnnouncementIds([]);
      return;
    }

    try {
      const response = await fetch('/api/announcements/active');
      if (!response.ok) {
        throw new Error(`Failed to load announcements (${response.status})`);
      }

      const data: AnnouncementApiResponse = await response.json();
      const formatted: Notification[] = (data.announcements ?? []).map((item) => ({
        id: item.id,
        title: item.title,
        message: item.body,
        variant: item.variant ?? 'info',
        priority: item.priority,
        publishedAt: item.publishedAt,
        cta: item.cta,
        source: 'announcement'
      }));

      setAnnouncements(formatted);
      setBannerDismissedIds((prev) => mergeIds(prev, data.dismissedAnnouncementIds));
      setAcknowledgedAnnouncementIds((prev) =>
        mergeIds(prev, data.dismissedAnnouncementIds)
      );
    } catch (error) {
      console.error('Failed to load announcements', error);
    }
  }, [shouldOperate, setAnnouncements]);

  refreshAnnouncementsRef.current = refreshAnnouncements;

  useEffect(() => {
    if (!shouldOperate) {
      setNotificationsBySource(createDefaultSources());
      setDismissedIds([]);
      setBannerDismissedIds([]);
      setAcknowledgedAnnouncementIds([]);
      return;
    }

    const run = async () => {
      await refreshAnnouncementsRef.current?.();
    };

    void run();
    const timer = setInterval(() => {
      void refreshAnnouncementsRef.current?.();
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(timer);
    };
  }, [shouldOperate]);

  const dismissAnnouncementBanner = useCallback(
    async (id: string) => {
      if (!id) return;
      setBannerDismissedIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
      if (shouldOperate) {
        await recordAnnouncementAcknowledgement(id);
      }
    },
    [recordAnnouncementAcknowledgement, shouldOperate]
  );

  const notifications = useMemo(() => {
    const all = Object.values(notificationsBySource).flat();
    const seen = new Set<string>();
    const combined: Notification[] = [];

    for (const notification of all) {
      if (!notification || seen.has(notification.id) || dismissedIdSet.has(notification.id)) {
        continue;
      }
      seen.add(notification.id);
      combined.push(notification);
    }

    combined.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    return combined;
  }, [notificationsBySource, dismissedIdSet]);

  const announcements = useMemo(
    () => notificationsBySource.announcement,
    [notificationsBySource]
  );

  const bannerAnnouncements = useMemo(
    () => announcements.filter((item) => !bannerDismissedIdSet.has(item.id)),
    [announcements, bannerDismissedIdSet]
  );

  const value = useMemo(
    () => ({
      notifications,
      announcements,
      bannerAnnouncements,
      setNotifications,
      setAnnouncements,
      dismiss,
      dismissAnnouncementBanner,
      refreshAnnouncements,
      dismissedIds,
      clear
    }),
    [
      notifications,
      announcements,
      bannerAnnouncements,
      setNotifications,
      setAnnouncements,
      dismiss,
      dismissAnnouncementBanner,
      refreshAnnouncements,
      dismissedIds,
      clear
    ]
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
