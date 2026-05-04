import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet-react';
import { useTheme } from 'next-themes';
import { Title } from '@tremor/react';
import { useToastContext } from '../hooks/ToastContext';
import Loading from '../components/Loading';
import EventCard, { DashboardEvent } from '../components/events/EventCard';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function EventsPage() {
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const { activeAccount } = useWallet();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const toast = useToastContext();

  const [events, setEvents] = useState<DashboardEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const walletReady = Boolean(devMode ? true : activeAccount);
  const isAuthenticated =
    sessionStatus === 'authenticated' && Boolean(session?.user?.address);

  useEffect(() => {
    if (sessionStatus === 'loading') return;
    if (!isAuthenticated) {
      router.push(`/signin?callbackUrl=${encodeURIComponent('/events')}`);
      return;
    }
    if (!walletReady) return;

    const fetchEvents = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/events');
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          const message = payload?.message || `HTTP ${res.status}`;
          throw new Error(message);
        }
        const data = await res.json();
        if (data?.success && Array.isArray(data.events)) {
          setEvents(data.events);
        } else {
          setEvents([]);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load events';
        setError(msg);
        toast.error({ heading: 'Events Error', message: msg });
      } finally {
        setIsLoading(false);
      }
    };

    fetchEvents();
  }, [isAuthenticated, walletReady, sessionStatus, router, toast]);

  if (sessionStatus === 'loading' || isLoading) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-black text-white' : 'bg-white text-slate-900'}`}>
        <div className="flex flex-col items-center gap-4">
          <Loading />
          <div className="text-sm text-gray-500 dark:text-gray-400">Loading events…</div>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className={`min-h-screen flex items-center justify-center ${isDark ? 'bg-black text-white' : 'bg-white text-slate-900'}`}>
        <div className="text-sm text-gray-500 dark:text-gray-400">Redirecting to sign in…</div>
      </div>
    );
  }

  return (
    <main className={`min-h-screen px-4 py-10 transition-colors ${isDark ? 'bg-black text-white' : 'bg-white text-slate-900'}`}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <div className="flex items-center justify-between">
          <Title className="text-2xl font-bold">Events</Title>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}

        {events.length === 0 && !error && (
          <div className="text-gray-500 text-sm">No active events yet.</div>
        )}

        <div className="grid gap-6">
          {events.map((event) => (
            <EventCard key={event._id} event={event} />
          ))}
        </div>
      </div>
    </main>
  );
}
