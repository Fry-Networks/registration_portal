import PageShell from "../components/PageShell";
import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Title, Card, Button, Badge, Text, Flex, Grid, Metric } from '@tremor/react';
import { useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet-react';
import { useTheme } from 'next-themes';
import { getClientToken } from '../lib/clientToken';
import { generateRequestSignatureAsync } from '../lib/requestSignature.client';
import dynamic from 'next/dynamic';
import { getServerTimestamp } from "../lib/serverTime";
import { GetServerSideProps } from 'next';
import { getConfigFlag } from '../lib/config';
import HeroBanner from '../components/HeroBanner';
import bgImg from '../assets/background.png';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider';
import { useToastContext } from '../hooks/ToastContext';
const DimoLoginSection = dynamic(() => import('../components/DimoLoginSection'), {
  ssr: false
});
// TEMP support gate for copying JWTs; keep false unless explicitly enabled during troubleshooting.
const JWT_COPY_ENABLED = false;
type SubscriptionView = {
  subscriptionId: string;
  plan: string;
  status: string;
  eligible: boolean;
  eligibilityReason: string;
  startedAt?: string;
  renewalAt?: string;
  graceExpiresAt?: string;
  claimed: boolean;
  minerKeyChecksum?: string;
};
const fetchWithSignature = async (endpoint: string, method: 'GET' | 'POST', payload: any = {}) => {
  // Frontend helper to reuse the existing HMAC signature + client token security stack.
  const token = await getClientToken();
  const timestamp = getServerTimestamp();
  const signature = await generateRequestSignatureAsync(method, endpoint, payload, timestamp);
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    'x-client-token': token,
    'x-request-signature': signature,
    'x-request-timestamp': timestamp.toString()
  };
  return fetch(endpoint, {
    method,
    headers,
    // Send the payload even on GET so the signature body matches what the server verifies.
    body: JSON.stringify(payload)
  });
};
export default function DimoPerksPage() {
  const {
    data: session,
    status
  } = useSession();
  const {
    activeAccount
  } = useWallet();
  const {
    resolvedTheme
  } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const {
    activeHoliday
  } = useSeasonalTheme();
  const holidayKey = activeHoliday?.key ?? null;
  const router = useRouter();

  const scrollToDimoLogin = () => {
    if (sdkCardRef.current) {
      sdkCardRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  const toast = useToastContext();
  const sdkCardRef = useRef<HTMLDivElement | null>(null);
  const [dimoAuthenticated, setDimoAuthenticated] = useState(true);
  const [subs, setSubs] = useState<SubscriptionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<{
    minerKey: string;
    checksum: string;
  } | null>(null);
  const [storedClaims, setStoredClaims] = useState<Record<string, {
    minerKey: string;
    checksum?: string;
  }>>({});
  const [registrationStatus, setRegistrationStatus] = useState<Record<string, {
    registered: boolean;
    checking?: boolean;
  }>>({});
  const [userJwt, setUserJwt] = useState('');
  // Track the last JWT used for sync so support can copy it when needed.
  const [lastUserJwt, setLastUserJwt] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [stateToken, setStateToken] = useState<string | null>(null);
  const connectedFlag = useMemo(() => {
    const value = router.query.connected;
    return Array.isArray(value) ? value.includes('1') : value === '1';
  }, [router.query.connected]);
  const logClientError = async (payload: Record<string, unknown>) => {
    try {
      await fetch('/api/logging/client-error', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          issueType: 'DIMO_CLAIM_CLIENT_ERROR',
          part: 'dimo.claim.client',
          ...payload
        })
      });
    } catch {
      // best-effort; ignore failures
    }
  };
  const loadEligible = useCallback(async () => {
    if (!session?.user?.address) return;
    setLoading(true);
    try {
      const resp = await fetchWithSignature('/api/dimo/eligible', 'POST');
      const data = await resp.json();
      if (resp.ok) {
        setSubs(data.subscriptions ?? []);
      } else {
        console.error('Failed to load DIMO subscriptions', data);
      }
    } catch (error) {
      console.error('Error fetching eligibility', error);
    } finally {
      setLoading(false);
    }
  }, [session?.user?.address]);
  const syncWithJwt = async (tokenOverride?: string) => {
    const tokenToUse = tokenOverride || userJwt;
    if (!tokenToUse || !session?.user?.address) return;
    setSyncing(true);
    setSyncMessage(null);
    // Cache the JWT used for this sync attempt (support-only copy helper).
    setLastUserJwt(tokenToUse);
    try {
      // Ensure state cookie is set before posting the token.
      let localState = stateToken;
      if (!localState) {
        const startResp = await fetchWithSignature('/api/dimo/start', 'POST');
        const startData = await startResp.json();
        if (!startResp.ok) {
          throw new Error(startData?.message || 'Failed to initiate DIMO sync');
        }
        localState = startData.state;
        setStateToken(localState);
      }
      const resp = await fetchWithSignature('/api/dimo/callback', 'POST', {
        userJwt: tokenToUse,
        state: localState
      });
      const data = await resp.json();
      if (resp.ok) {
        setSyncMessage('DIMO subscriptions synced successfully. Refreshing list...');
        setUserJwt(tokenOverride ? userJwt : '');
        await loadEligible();
      } else {
        setSyncMessage(data?.message || 'Failed to sync DIMO subscriptions');
        // Surface the server-provided reason in a toast so users see next steps.
        toast.error({
          heading: 'DIMO sync failed',
          message: data?.action ? `${data?.message} ${data?.action}` : data?.message || 'Unable to sync your DIMO subscriptions.'
        });
      }
    } catch (error: any) {
      setSyncMessage(error?.message || 'Failed to sync DIMO subscriptions');
      // Fall back to a generic toast when the request fails before a response.
      toast.error({
        heading: 'DIMO sync failed',
        message: error?.message || 'Unable to sync your DIMO subscriptions.'
      });
    } finally {
      setSyncing(false);
    }
  };

  // Load any locally-stored claimed miner keys for this wallet to re-display after navigation/refresh.
  useEffect(() => {
    if (!session?.user?.address) return;
    if (typeof window === 'undefined') return;
    const raw = window.localStorage.getItem('dimo-claimed-keys');
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, {
        minerKey: string;
        checksum?: string;
      }>;
      setStoredClaims(parsed || {});
    } catch {
      // ignore malformed storage
    }
  }, [session?.user?.address]);
  const persistClaim = useCallback((subscriptionId: string, minerKey: string, checksum?: string) => {
    const wallet = session?.user?.address || 'unknown';
    const key = `${wallet}:${subscriptionId}`;
    setStoredClaims(prev => {
      const next = {
        ...prev,
        [key]: {
          minerKey,
          checksum
        }
      };
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('dimo-claimed-keys', JSON.stringify(next));
        } catch {
          // best effort persistence
        }
      }
      return next;
    });
  }, [session?.user?.address]);
  const claimKey = async (subscriptionId: string) => {
    if (!subscriptionId || subscriptionId.trim().length === 0) {
      await logClientError({
        message: 'DIMO claim attempted without subscription id',
        issueType: 'DIMO_CLAIM_CLIENT_ERROR',
        part: 'dimo.claim.client',
        url: '/api/dimo/claim'
      });
      return;
    }
    setClaiming(subscriptionId);
    setIssuedKey(null);
    try {
      const resp = await fetchWithSignature('/api/dimo/claim', 'POST', {
        subscriptionId
      });
      const text = await resp.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {
          message: text
        };
      }
      if (resp.ok) {
        setIssuedKey({
          minerKey: data.minerKey,
          checksum: data.minerKeyChecksum
        });
        persistClaim(subscriptionId, data.minerKey, data.minerKeyChecksum);
        // Refresh eligibility list to show claimed state.
        void loadEligible();
      } else {
        await logClientError({
          message: `DIMO claim failed (${resp.status})`,
          reason: data?.message ?? text ?? 'No body',
          url: '/api/dimo/claim',
          minerKey: subscriptionId
        });
        console.error('Claim failed', data || text);
      }
    } catch (error) {
      console.error('Error claiming key', error);
    } finally {
      setClaiming(null);
    }
  };
  const copyLastJwt = useCallback(async () => {
    if (!lastUserJwt) return;
    try {
      await navigator.clipboard.writeText(lastUserJwt);
      setSyncMessage('DIMO token copied to clipboard.');
    } catch {
      setSyncMessage('Unable to copy DIMO token. Please use DevTools.');
    }
  }, [lastUserJwt]);
  const checkRegistrationStatus = useCallback(async (minerKey: string) => {
    if (!session?.user?.address) return;
    setRegistrationStatus(prev => ({
      ...prev,
      [minerKey]: {
        registered: false,
        checking: true
      }
    }));
    try {
      const resp = await fetchWithSignature(`/api/devices/${encodeURIComponent(minerKey)}`, 'POST', {
        address: session.user.address
      });
      if (resp.ok) {
        const data = await resp.json();
        const registered = Boolean(data?.device?.is_registered);
        setRegistrationStatus(prev => ({
          ...prev,
          [minerKey]: {
            registered,
            checking: false
          }
        }));
      } else {
        setRegistrationStatus(prev => ({
          ...prev,
          [minerKey]: {
            registered: false,
            checking: false
          }
        }));
      }
    } catch {
      setRegistrationStatus(prev => ({
        ...prev,
        [minerKey]: {
          registered: false,
          checking: false
        }
      }));
    }
  }, [session?.user?.address]);
  useEffect(() => {
    if (status === 'authenticated' && activeAccount?.address === session?.user?.address) {
      void loadEligible();
    }
  }, [status, session, activeAccount, dimoAuthenticated, loadEligible]);

  // When we have stored claims, check registration status so we can update the onboarding CTA state.
  // Check registration state once per claimed key (avoid re-looping every render).
  useEffect(() => {
    if (!session?.user?.address) return;
    Object.values(storedClaims).forEach(claim => {
      if (!claim?.minerKey) return;
      if (registrationStatus[claim.minerKey]?.checking === true || registrationStatus[claim.minerKey]?.registered === true || registrationStatus[claim.minerKey]?.registered === false) {
        return;
      }
      void checkRegistrationStatus(claim.minerKey);
    });
  }, [storedClaims, session?.user?.address, checkRegistrationStatus, registrationStatus]);
  const needsWallet = !activeAccount || activeAccount.address !== session?.user?.address;
  useEffect(() => {
    if (needsWallet) {
      setDimoAuthenticated(false);
    }
  }, [needsWallet]);
  const panelClass = isDark ? 'relative overflow-hidden border border-primary-500/30 bg-[#0b0b0f] bg-[radial-gradient(circle_at_top,_rgba(248,113,113,0.12),_transparent_60%)] shadow-[0_24px_40px_-24px_rgba(248,113,113,0.55)] text-ink' : 'relative overflow-hidden border border-red-200 bg-surface-elevated shadow-[0_18px_30px_rgba(15,23,42,0.12)] text-ink';
  const subCardClass = 'group relative overflow-hidden border border-primary-500/40 bg-[#0b0b0f] bg-[radial-gradient(circle_at_top,_rgba(248,113,113,0.12),_transparent_60%)] p-4 sm:p-5 shadow-[0_24px_40px_-24px_rgba(248,113,113,0.55)] hover:border-primary-400/60 hover:-translate-y-0.5 transition-all duration-300';
  const subCardClassLight = 'group relative overflow-hidden border border-red-200 bg-surface-elevated p-4 sm:p-5 shadow-[0_18px_30px_rgba(15,23,42,0.12)] hover:border-primary-300 hover:-translate-y-0.5 transition-all duration-300 text-ink';
  const heroOffsetClass = holidayKey === 'christmas' ? 'mt-10 sm:mt-14' : 'mt-2';
  return (
    <PageShell title="DIMO" breadcrumb={true}>
      <div className="mx-auto max-w-7xl px-4 py-space-8">
        <div className={heroOffsetClass}>
          <HeroBanner
            title="DIMO Airdrop · Fry Edge Miner"
            subtitle="Link your DIMO account, sync your subscriptions, and claim your free Fry Edge Miner key."
            backgroundImage={bgImg}
            showPrices={false}
            mode={isDark ? 'dark' : 'light'}
            holidayKey={holidayKey}
            rightSlot={connectedFlag ? (
              <span className="inline-flex items-center rounded-token-md px-2.5 py-1 text-xs font-semibold bg-success-500/10 text-success-500 border border-success-500/20">
                DIMO connected
              </span>
            ) : null}
          />
        </div>

        {/* Wallet connect prompt */}
        {needsWallet && (
          <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-5 mb-space-6">
            <p className="text-sm text-ink-secondary font-body">
              Connect the wallet you plan to use. DIMO claims are bound to your session wallet.
            </p>
          </div>
        )}

        {/* Claimed keys hero panel */}
        {(() => {
          const wallet = session?.user?.address || 'unknown';
          const claimedEntries = Object.entries(storedClaims).filter(([k]) => k.startsWith(wallet + ':'));
          if (claimedEntries.length === 0) return null;
          return (
            <div className="bg-surface-elevated border border-accent-500/30 rounded-token-xl p-space-6 mb-space-6 space-y-space-4">
              {claimedEntries.map(([key, val]) => {
                const subId = key.split(':')[1];
                const regState = registrationStatus[val.minerKey];
                const registered = regState?.registered;
                const onboardingHref = `/register?miner_key=${encodeURIComponent(val.minerKey)}&from_dimo=1`;
                return (
                  <div key={key} className="space-y-space-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm text-ink-secondary uppercase tracking-wider font-display">
                        Your AEM Miner Key
                      </span>
                      <span className="inline-flex items-center rounded-token-md px-2 py-0.5 text-xs font-medium bg-warning-500/10 text-warning-500 border border-warning-500/20">
                        Claimed
                      </span>
                    </div>
                    <div className="flex items-start gap-space-2">
                      <div className="flex-1 text-xl font-mono bg-surface-strong p-3 rounded-token-md break-all text-ink">
                        {val.minerKey}
                      </div>
                      <button
                        onClick={() => navigator.clipboard.writeText(val.minerKey)}
                        className="bg-surface-strong border border-divider hover:border-primary-500 px-3 py-1.5 rounded-token-sm text-sm text-ink-secondary hover:text-ink transition shrink-0"
                      >
                        Copy
                      </button>
                    </div>
                    <button
                      onClick={() => { if (!registered) void router.push(onboardingHref); }}
                      disabled={registered === true}
                      className={`inline-block px-6 py-3 rounded-token-md font-semibold transition mt-2 ${registered ? 'opacity-50 cursor-not-allowed bg-surface-strong text-ink-muted' : 'bg-primary-500 hover:bg-primary-600 text-ink'}`}
                    >
                      {registered ? 'Registered successfully' : 'Start Onboarding →'}
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })()}

        {/* Not connected CTA */}
        {!needsWallet && !connectedFlag && subs.length === 0 && !loading && (
          <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-8 max-w-lg mx-auto text-center mt-space-10">
            <svg className="w-12 h-12 text-primary-500 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <h3 className="text-2xl font-display font-bold text-ink mt-4">
              Connect Your DIMO Account
            </h3>
            <p className="text-ink-secondary mt-2 font-body">
              Link your DIMO account to claim your free Fry Edge Miner key.
            </p>
            <button
              onClick={scrollToDimoLogin}
              className="bg-primary-500 hover:bg-primary-600 text-ink px-6 py-3 rounded-token-md font-semibold mt-6 transition"
            >
              Connect DIMO →
            </button>
          </div>
        )}

        {/* DimoLoginSection */}
        <div ref={sdkCardRef} className="mb-space-6">
          <DimoLoginSection
            onSync={token => syncWithJwt(token)}
            syncing={syncing}
            connected={!needsWallet}
            token={userJwt}
            onTokenChange={setUserJwt}
            className="bg-surface-elevated border border-divider rounded-token-xl p-space-5"
            onAuthChange={setDimoAuthenticated}
          />
        </div>

        {/* JWT copy support */}
        {JWT_COPY_ENABLED && lastUserJwt && (
          <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-5 mb-space-6">
            <div className="flex items-center justify-between">
              <p className="text-sm text-ink-secondary font-body">Support: copy the last DIMO token used for sync.</p>
              <button
                onClick={copyLastJwt}
                className="px-3 py-1.5 rounded-token-md text-xs font-semibold bg-primary-500 hover:bg-primary-600 text-ink transition"
              >
                Copy JWT
              </button>
            </div>
          </div>
        )}

        {/* Sync message */}
        {syncMessage && (
          <div className="bg-accent-500/5 border border-accent-500/20 rounded-token-xl p-space-5 mb-space-6">
            <p className="text-sm text-accent-500 font-body">{syncMessage}</p>
          </div>
        )}

        {/* Subscriptions */}
        <div className="mt-space-6">
          <div className="flex items-center justify-between mb-space-4">
            <h2 className="text-xl font-display font-semibold text-ink">Your subscriptions</h2>
            <button
              onClick={loadEligible}
              disabled={needsWallet || loading}
              className="px-3 py-1.5 rounded-token-md text-xs font-semibold bg-surface-strong border border-divider text-ink-secondary hover:text-ink hover:border-primary-500/50 transition disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>

          {subs.length === 0 && !loading && (
            <div className="bg-surface-elevated border border-divider rounded-token-lg p-space-5">
              <p className="text-sm text-ink-secondary font-body">
                No DIMO subscriptions detected yet. Please sync your DIMO account above and refresh.
              </p>
              <p className="mt-3 text-xs text-ink-muted font-body">
                Only active monthly or annual subscriptions prior to December 23rd 2025 are eligible for this airdrop.
                New Annual DIMO subscriptions only that enroll between December 24th to December 31st 2025, will be eligible as well.
                Post January 1st 2026, no new subscriptions will be eligible anymore.
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-space-4">
            {subs.map(sub => (
              <div key={sub.subscriptionId} className="bg-surface-elevated border border-divider rounded-token-lg p-space-5 flex flex-col">
                <div className="text-lg font-bold text-ink capitalize font-display">{sub.plan}</div>
                <div className="text-sm text-ink-secondary mt-1 font-body">{sub.status} · {sub.eligible ? 'Eligible' : 'Not eligible'}</div>

                {/* Additional info */}
                <div className="mt-3 space-y-1 text-xs text-ink-secondary font-body">
                  {sub.startedAt && (
                    <div>Started: {new Date(sub.startedAt).toLocaleDateString()}</div>
                  )}
                  {sub.renewalAt && (
                    <div>Renews: {new Date(sub.renewalAt).toLocaleDateString()}</div>
                  )}
                  {sub.graceExpiresAt && (
                    <div>Grace ends: {new Date(sub.graceExpiresAt).toLocaleDateString()}</div>
                  )}
                </div>

                <div className="mt-auto pt-space-4">
                  {sub.claimed && sub.minerKeyChecksum ? (
                    <span className="inline-flex items-center rounded-token-md px-2.5 py-1 text-xs font-medium bg-warning-500/10 text-warning-500 border border-warning-500/20">
                      Claimed
                    </span>
                  ) : (
                    <div className="relative">
                      <span className="absolute inset-0 rounded-token-md ring-2 ring-primary-500/30" />
                      <button
                        onClick={() => claimKey(sub.subscriptionId)}
                        disabled={!sub.eligible || claiming === sub.subscriptionId || !sub.subscriptionId || !sub.plan || sub.plan === 'unknown'}
                        className="relative w-full bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-ink py-3 rounded-token-md font-semibold transition"
                      >
                        {claiming === sub.subscriptionId ? 'Claiming...' : 'Claim Free AEM Key'}
                      </button>
                    </div>
                  )}

                  {sub.claimed && (() => {
                    const wallet = session?.user?.address || 'unknown';
                    const stored = storedClaims[`${wallet}:${sub.subscriptionId}`];
                    if (!stored?.minerKey) return null;
                    const onboardingHref = `/register?miner_key=${encodeURIComponent(stored.minerKey)}&from_dimo=1`;
                    const regState = registrationStatus[stored.minerKey];
                    const registered = regState?.registered;
                    return (
                      <div className="mt-3 space-y-2 w-full">
                        <p className="text-sm text-ink font-body">Your AEM miner key:</p>
                        <div className="bg-surface-strong border border-divider rounded-token-md px-3 py-2 font-mono text-sm break-all text-ink">
                          {stored.minerKey}
                        </div>
                        <button
                          disabled={registered === true}
                          className={`w-full px-4 py-2 rounded-token-md text-sm font-semibold transition ${registered ? 'opacity-50 cursor-not-allowed bg-surface-strong text-ink-muted' : 'bg-primary-500 hover:bg-primary-600 text-ink'}`}
                          onClick={() => {
                            if (registered) return;
                            void router.push(onboardingHref);
                          }}
                        >
                          {registered ? 'Registered successfully' : 'Start onboarding'}
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Back to top */}
        <div className="flex justify-end pt-space-6">
          <button
            type="button"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="text-sm text-ink-secondary hover:text-primary-500 transition font-body"
          >
            Back to top ↑
          </button>
        </div>
      </div>
    </PageShell>
  );
}
export const getServerSideProps: GetServerSideProps = async () => {
  const enabled = await getConfigFlag('dimo_enabled', true);
  if (!enabled) {
    return {
      redirect: {
        destination: '/devices',
        permanent: false
      }
    };
  }
  return {
    props: {}
  };
};

