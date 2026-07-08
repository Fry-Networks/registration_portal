import { useEffect, useState } from 'react';

interface ActiveEvent {
  _id: string;
  title: string;
  status: string;
}

interface UseActiveEventsResult {
  hasActiveEvent: boolean;
  activeCount: number;
  loading: boolean;
  error: Error | null;
}

export default function useActiveEvents(): UseActiveEventsResult {
  const [events, setEvents] = useState<ActiveEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const fetchActive = async () => {
      try {
        setLoading(true);
        const resp = await fetch('/api/events/active', {
          signal: controller.signal,
          headers: { 'Accept': 'application/json' }
        });
        if (!resp.ok) {
          // Auth-required: silently return empty when unauthenticated (401/403)
          if (resp.status === 401 || resp.status === 403) {
            if (!cancelled) { setEvents([]); setError(null); }
            return;
          }
          throw new Error(`Failed to load active events: ${resp.status}`);
        }
        const data = await resp.json();
        if (!cancelled) {
          const list = Array.isArray(data) ? data : data?.events ?? [];
          setEvents(list);
          setError(null);
        }
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        console.warn('[useActiveEvents] fetch failed', err);
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setEvents([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchActive();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const activeCount = events.length;
  const hasActiveEvent = activeCount > 0;

  return { hasActiveEvent, activeCount, loading, error };
}
