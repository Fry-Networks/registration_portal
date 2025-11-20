import { useDevWallet } from '../hooks/UseDevWallet';
import { useWallet } from '@txnlab/use-wallet-react';
import { useSession } from 'next-auth/react';
import HeroBanner from '../components/HeroBanner';
import bgImg from '../assets/background.png';
import SignIn from '../components/SignIn';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function IndexPage() {
  const { devConnect } = useDevWallet();
  const { activeAccount } = useWallet();
  const { data: session, status } = useSession();

  const walletReady = Boolean((devMode && devConnect) || activeAccount);
  const isAuthenticated =
    status === 'authenticated' && Boolean(session?.user?.address);
  const showOnboardingCopy = !isAuthenticated;

  return (
    <main className="min-h-screen bg-gradient-to-b from-black via-[#150005] to-black px-4 py-10 text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10">
        <HeroBanner
          title="Register and Manage Your Devices with Fry Networks"
          subtitle="Onboard, verify, and manage your miners and nodes with a single, secure dashboard. Track participation, stats and performance (coming soon), and rewards with real-time clarity."
          backgroundImage={bgImg}
          showPrices={false}
        />

        <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 shadow-[0_25px_60px_rgba(0,0,0,0.55)] backdrop-blur-2xl sm:p-8">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-35 mix-blend-screen"
            style={{
              backgroundImage: `url(${bgImg.src})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              transform: 'scaleX(-1)'
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,0,90,0.15),_transparent_55%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-6 top-0 h-1 bg-gradient-to-r from-transparent via-red-400/70 to-transparent blur-[1px] animate-pulse"
          />
          <div
            className={`relative grid gap-10 ${
              showOnboardingCopy
                ? 'lg:grid-cols-[1.05fr_minmax(0,420px)] lg:items-center'
                : ''
            }`}
          >
            {showOnboardingCopy && (
              <div className="space-y-5">
                <p className="text-[11px] uppercase tracking-[0.4em] text-red-200/80">
                  Onboarding
                </p>
                <h2 className="text-2xl font-semibold text-white sm:text-3xl">
                  Connect, authorize, and launch your dashboard.
                </h2>
                <p className="text-sm leading-relaxed text-red-100/80 sm:text-base">
                  Start by connecting your Algorand wallet, signing the secure
                  challenge, and then jump straight into the dashboard.
                </p>
                <div className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-xs uppercase tracking-[0.3em] text-red-100/80 shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
                  Wallets supported: Pera • Defly
                </div>
              </div>
            )}
            <div
              className={`rounded-2xl border border-white/10 bg-black/60 p-4 shadow-[0_25px_50px_rgba(0,0,0,0.55)] ${
                showOnboardingCopy ? '' : 'mx-auto w-full max-w-xl'
              }`}
            >
              {walletReady ? (
                <SignIn />
              ) : (
                <div className="space-y-4 text-center">
                  <p className="text-sm text-white/80">
                    Connect a supported Algorand wallet to continue.
                  </p>
                  <p className="text-xs text-white/60">
                    Once connected, we’ll prompt you to sign a zero-value
                    transaction to verify ownership and unlock the dashboard.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
