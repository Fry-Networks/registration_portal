import { useDevWallet } from '../hooks/UseDevWallet';
import { useWallet } from '@txnlab/use-wallet-react';
import { useSession } from 'next-auth/react';
import HeroBanner from '../components/HeroBanner';
import bgImg from '../assets/background.png';
import SignIn from '../components/SignIn';
import { useTheme } from 'next-themes';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider'; // Pass holiday state to hero
import HappyHolidaysImg from '../lib/holiday/Happy-Holidays.png';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function IndexPage() {
  const { devConnect } = useDevWallet();
  const { activeAccount } = useWallet();
  const { data: session, status } = useSession();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light'; // default to dark until theme resolves
  const { activeHoliday } = useSeasonalTheme();
  const holidayKey = activeHoliday?.key ?? null;

  const walletReady = Boolean((devMode && devConnect) || activeAccount);
  const isAuthenticated =
    status === 'authenticated' && Boolean(session?.user?.address);
  const showOnboardingCopy = !isAuthenticated;
  const today = new Date();
  const year = today.getUTCFullYear();
  const holidayStart = new Date(Date.UTC(year, 10, 25)); // Nov 25 UTC
  const holidayEnd = new Date(Date.UTC(year + 1, 0, 3)); // Jan 3 UTC (exclusive)
  const showHolidayBanner =
    today.getTime() >= holidayStart.getTime() && today.getTime() < holidayEnd.getTime();

  return (
    <main
      className={`min-h-screen px-4 py-10 transition-colors ${
        isDark
          ? 'bg-gradient-to-b from-black via-[#150005] to-black text-white'
          : 'bg-gradient-to-b from-[#f8fafc] via-[#ffe8ee] to-white text-slate-900'
      }`}
    >
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <HeroBanner
          title="Register and Manage Your Devices with Fry Networks"
          subtitle="Onboard, verify, and manage your miners and nodes with a single, secure dashboard. Track participation, stats and performance (coming soon), and rewards with real-time clarity."
          backgroundImage={bgImg}
          showPrices={false}
          mode={isDark ? 'dark' : 'light'}
          holidayKey={holidayKey}
        />

        <section
          className={`relative overflow-hidden rounded-3xl p-6 shadow-[0_25px_60px_rgba(0,0,0,0.45)] backdrop-blur-2xl sm:p-8 ${
            isDark
              ? 'border border-white/10 bg-white/5'
              : 'border border-red-500/50 bg-gradient-to-r from-[#e54152] via-[#d92b3c] to-[#e75b66]'
          }`}
        >
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 ${isDark ? 'opacity-35 mix-blend-screen' : 'opacity-25'}`}
            style={{
              backgroundImage: `url(${bgImg.src})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              transform: 'scaleX(-1)'
            }}
          />
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 ${
              isDark
                ? 'bg-gradient-to-br from-black/70 via-red-900/20 to-black/60'
                : 'bg-gradient-to-br from-white/60 via-red-200/35 to-white/30'
            }`}
          />
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,0,90,0.15),_transparent_55%)] ${
              isDark ? 'opacity-60' : 'opacity-55'
            }`}
          />
          <div
            aria-hidden
            className={`pointer-events-none absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-transparent via-red-400/70 to-transparent blur-[1px] animate-pulse ${
              isDark ? '' : 'opacity-70'
            }`}
          />
          <div
            className={`relative grid gap-8 ${
              showHolidayBanner
                ? 'lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-center'
                : 'lg:grid-cols-1'
            }`}
          >
            <div className="space-y-6">
              {showOnboardingCopy && (
                <div className="space-y-5">
                  <p
                    className={`text-[11px] uppercase tracking-[0.4em] ${
                      isDark ? 'text-red-200/80' : 'text-red-700/80'
                    }`}
                  >
                    Onboarding
                  </p>
                  <h2
                    className={`text-2xl font-semibold sm:text-3xl ${
                      isDark ? 'text-white' : 'text-slate-900'
                    }`}
                  >
                    Connect, authorize, and launch your dashboard.
                  </h2>
                  <p
                    className={`text-sm leading-relaxed sm:text-base ${
                      isDark ? 'text-red-100/80' : 'text-slate-700'
                    }`}
                  >
                    Start by connecting your Algorand wallet, signing the secure
                    challenge, and then jump straight into the dashboard.
                  </p>
                  <div
                    className={`rounded-2xl border px-4 py-3 text-xs uppercase tracking-[0.3em] shadow-[0_10px_30px_rgba(0,0,0,0.25)] ${
                      isDark
                        ? 'border-white/10 bg-black/30 text-red-100/80'
                        : 'border-red-300/90 bg-white text-red-700/90'
                    }`}
                  >
                    Wallets supported: Pera • Defly
                  </div>
                </div>
              )}
              <div
                className={`rounded-2xl border p-4 shadow-[0_25px_50px_rgba(0,0,0,0.45)] ${
                  isDark ? 'border-white/10 bg-black/60' : 'border-red-200/80 bg-white'
                } ${showOnboardingCopy ? '' : 'mx-auto w-full max-w-xl'}`}
              >
                {walletReady ? (
                  <SignIn />
                ) : (
                  <div className="space-y-4 text-center">
                    <p className={`text-sm ${isDark ? 'text-white/80' : 'text-slate-800'}`}>
                      Connect a supported Algorand wallet to continue.
                    </p>
                    <p className={`text-xs ${isDark ? 'text-white/60' : 'text-slate-700'}`}>
                      Once connected, we’ll prompt you to sign a zero-value
                      transaction to verify ownership and unlock the dashboard.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {showHolidayBanner && (
              <div className="relative flex items-center justify-center rounded-2xl border border-white/10 bg-transparent p-2 sm:p-3 shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
                <img
                  src={HappyHolidaysImg.src}
                  alt="Happy Holidays"
                  className="h-full w-full rounded-xl object-contain"
                  style={{
                    filter: 'drop-shadow(0 12px 28px rgba(0,0,0,0.3))'
                  }}
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
