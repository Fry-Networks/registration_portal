import { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { Title, Card, Button, Badge, Text, Flex, Grid, Metric } from '@tremor/react';
import { useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet-react';
import { useTheme } from 'next-themes';
import { getClientToken } from '../lib/clientToken';
import { generateRequestSignatureAsync } from '../lib/requestSignature.client';
import dynamic from 'next/dynamic';
import { GetServerSideProps } from 'next';
import { getConfigFlag } from '../lib/config';
import HeroBanner from '../components/HeroBanner';
import bgImg from '../assets/background.png';
import { useSeasonalTheme } from '../app/seasonal-theme/SeasonalThemeProvider';
import { useToastContext } from '../hooks/ToastContext';

const DimoLoginSection = dynamic(() => import('../components/DimoLoginSection'), { ssr: false });
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
  const timestamp = Math.floor(Date.now() / 1000);
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
  const { data: session, status } = useSession();
  const { activeAccount } = useWallet();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const { activeHoliday } = useSeasonalTheme();
  const holidayKey = activeHoliday?.key ?? null;
  const router = useRouter();
  const toast = useToastContext();
  const sdkCardRef = useRef<HTMLDivElement | null>(null);
  const [dimoAuthenticated, setDimoAuthenticated] = useState(true);
  const [subs, setSubs] = useState<SubscriptionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<{ minerKey: string; checksum: string } | null>(null);
  const [storedClaims, setStoredClaims] = useState<Record<string, { minerKey: string; checksum?: string }>>({});
  const [registrationStatus, setRegistrationStatus] = useState<Record<string, { registered: boolean; checking?: boolean }>>({});
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
        headers: { 'Content-Type': 'application/json' },
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
      const parsed = JSON.parse(raw) as Record<string, { minerKey: string; checksum?: string }>;
      setStoredClaims(parsed || {});
    } catch {
      // ignore malformed storage
    }
  }, [session?.user?.address]);

  const persistClaim = useCallback(
    (subscriptionId: string, minerKey: string, checksum?: string) => {
      const wallet = session?.user?.address || 'unknown';
      const key = `${wallet}:${subscriptionId}`;
      setStoredClaims((prev) => {
        const next = { ...prev, [key]: { minerKey, checksum } };
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem('dimo-claimed-keys', JSON.stringify(next));
          } catch {
            // best effort persistence
          }
        }
        return next;
      });
    },
    [session?.user?.address]
  );

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
      const resp = await fetchWithSignature('/api/dimo/claim', 'POST', { subscriptionId });
      const text = await resp.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { message: text };
      }
      if (resp.ok) {
        setIssuedKey({ minerKey: data.minerKey, checksum: data.minerKeyChecksum });
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

  const checkRegistrationStatus = useCallback(
    async (minerKey: string) => {
      if (!session?.user?.address) return;
      setRegistrationStatus((prev) => ({ ...prev, [minerKey]: { registered: false, checking: true } }));
      try {
        const resp = await fetchWithSignature(`/api/devices/${encodeURIComponent(minerKey)}`, 'POST', {
          address: session.user.address
        });
        if (resp.ok) {
          const data = await resp.json();
          const registered = Boolean(data?.device?.is_registered);
          setRegistrationStatus((prev) => ({ ...prev, [minerKey]: { registered, checking: false } }));
        } else {
          setRegistrationStatus((prev) => ({ ...prev, [minerKey]: { registered: false, checking: false } }));
        }
      } catch {
        setRegistrationStatus((prev) => ({ ...prev, [minerKey]: { registered: false, checking: false } }));
      }
    },
    [session?.user?.address]
  );

  useEffect(() => {
    if (status === 'authenticated' && activeAccount?.address === session?.user?.address) {
      void loadEligible();
    }
  }, [status, session, activeAccount, dimoAuthenticated, loadEligible]);

  // When we have stored claims, check registration status so we can update the onboarding CTA state.
  // Check registration state once per claimed key (avoid re-looping every render).
  useEffect(() => {
    if (!session?.user?.address) return;
    Object.values(storedClaims).forEach((claim) => {
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
  const panelClass = isDark
    ? 'relative overflow-hidden border border-red-500/30 bg-[#0b0b0f] bg-[radial-gradient(circle_at_top,_rgba(248,113,113,0.12),_transparent_60%)] shadow-[0_24px_40px_-24px_rgba(248,113,113,0.55)] text-white'
    : 'relative overflow-hidden border border-red-200 bg-white shadow-[0_18px_30px_rgba(15,23,42,0.12)] text-slate-900';
  const subCardClass =
    'group relative overflow-hidden border border-red-500/40 bg-[#0b0b0f] bg-[radial-gradient(circle_at_top,_rgba(248,113,113,0.12),_transparent_60%)] p-4 sm:p-5 shadow-[0_24px_40px_-24px_rgba(248,113,113,0.55)] hover:border-red-400/60 hover:-translate-y-0.5 transition-all duration-300';
  const subCardClassLight =
    'group relative overflow-hidden border border-red-200 bg-white p-4 sm:p-5 shadow-[0_18px_30px_rgba(15,23,42,0.12)] hover:border-red-300 hover:-translate-y-0.5 transition-all duration-300 text-slate-900';
  const heroOffsetClass = holidayKey === 'christmas' ? 'mt-10 sm:mt-14' : 'mt-2';

  return (
    <main className={`p-4 md:p-10 mx-auto max-w-6xl space-y-6 ${isDark ? 'text-white' : 'text-slate-900'}`}>
      <div className={heroOffsetClass}>
        <HeroBanner
          title="DIMO Airdrop · Fry AI Edge Miner"
          // Surface all subscriptions (eligible + ineligible) to reduce user confusion.
          subtitle="Link your DIMO account, sync your subscriptions, and claim your free AEM miner key."
          backgroundImage={bgImg}
          showPrices={false}
          mode={isDark ? 'dark' : 'light'}
          holidayKey={holidayKey}
          rightSlot={
            connectedFlag ? (
              <Badge
                color="green"
                className={`border ${isDark ? 'bg-green-500/20 text-green-100 border-green-400/50' : 'bg-green-100 text-green-800 border-green-300'}`}
              >
                DIMO connected
              </Badge>
            ) : null
          }
        />
      </div>

      {needsWallet && (
        <Card className={panelClass}>
          <Text className={isDark ? 'text-red-100/80' : 'text-slate-800'}>
            Connect the wallet you plan to use. DIMO claims are bound to your session wallet.
          </Text>
        </Card>
      )}

      <div ref={sdkCardRef}>
        <DimoLoginSection
          onSync={(token) => syncWithJwt(token)}
          syncing={syncing}
          connected={!needsWallet}
          token={userJwt}
          onTokenChange={setUserJwt}
          className={panelClass}
          onAuthChange={setDimoAuthenticated}
        />
      </div>

      {JWT_COPY_ENABLED && lastUserJwt && (
        <Card className={panelClass}>
          {/* Support-only action to copy the last DIMO JWT used for sync. */}
          <Flex justifyContent="between" alignItems="center">
            <Text className={isDark ? 'text-white' : 'text-slate-800'}>
              Support: copy the last DIMO token used for sync.
            </Text>
            <Button
              onClick={copyLastJwt}
              className={`border bg-red-600 text-white hover:bg-red-500 hover:border-red-400 ${
                isDark ? 'border-red-500' : 'border-red-500'
              }`}
            >
              Copy JWT
            </Button>
          </Flex>
        </Card>
      )}

      {syncMessage && (
        <Card className={panelClass}>
          <Text className={isDark ? 'text-white' : 'text-slate-800'}>{syncMessage}</Text>
        </Card>
      )}

      <Card className={panelClass}>
        <Flex justifyContent="between" alignItems="center" className="mb-4">
          {/* Show all subscriptions so users can see ineligible entries and reasons. */}
          <Metric className={isDark ? 'text-white dark:text-white' : 'text-slate-900'}>Your subscriptions</Metric>
          <Button
            onClick={loadEligible}
            loading={loading}
            disabled={needsWallet}
            className={`border bg-red-600 text-white hover:bg-red-500 hover:border-red-400 disabled:opacity-50 disabled:cursor-not-allowed ${isDark ? 'border-red-500' : 'border-red-500'}`}
          >
            Refresh
          </Button>
        </Flex>
        {subs.length === 0 && (
          <>
            <Text className={isDark ? 'text-gray-200' : 'text-slate-800'}>
              No DIMO subscriptions detected yet. Please sync your DIMO account above and refresh.
            </Text>
            {/* Eligibility policy summary for transparency. */}
            <Text className={`mt-3 text-sm ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
              Only active monthly or annual subscriptions prior to December 23rd 2025 are eligible for this airdrop.
              New Annual DIMO subscriptions only that enroll between December 24th to December 31st 2025, will be eligible as well.
              Post January 1st 2026, no new subscriptions will be eligible anymore. Please ensure you have synced your DIMO account above.
            </Text>
          </>
        )}
        <Grid numItemsSm={1} numItemsMd={2} className="gap-4">
          {subs.map((sub) => (
            <Card
              key={sub.subscriptionId}
              className={`${isDark ? subCardClass : subCardClassLight} space-y-3`}
            >
              <Flex alignItems="center" justifyContent="start" className="gap-2 flex-wrap">
                <Text className={isDark ? 'text-white' : 'text-slate-900'}>Subscription:</Text>
                <Badge color={sub.plan === 'annual' || sub.plan === 'monthly' ? 'green' : 'gray'}>
                  {sub.plan === 'annual' || sub.plan === 'monthly' ? sub.plan : 'Not eligible'}
                </Badge>
              </Flex>
              <Flex alignItems="center" justifyContent="start" className="gap-2 flex-wrap">
                <Text className={isDark ? 'text-white' : 'text-slate-900'}>Status:</Text>
                <Badge color="blue">{sub.status}</Badge>
              </Flex>
              {sub.startedAt && (
                <Flex alignItems="center" justifyContent="start" className="gap-2 flex-wrap">
                  <Text className={isDark ? 'text-white' : 'text-slate-900'}>Started:</Text>
                  <Badge color="indigo">{new Date(sub.startedAt).toLocaleDateString()}</Badge>
                </Flex>
              )}
              {sub.graceExpiresAt && (
                <div className="space-y-1">
                  <Text className={isDark ? 'text-white' : 'text-slate-900'}>
                    Grace window ends: {new Date(sub.graceExpiresAt).toLocaleDateString()}
                  </Text>
                  <Text className={`text-xs ${isDark ? 'text-gray-300' : 'text-slate-700'}`}>
                    7 days after announcement. Existing monthly/yearly subs are eligible; New users that subscribe between now and the end of the grace window, will need to have a yearly plan to qualify. New monthly plans do not qualify. Anything after this date isn’t eligible for this drop.
                  </Text>
                </div>
              )}
              {sub.claimed && sub.minerKeyChecksum ? (
                <Badge color="amber" className={isDark ? 'text-white' : 'text-slate-900'}>Claimed</Badge>
              ) : (
                <Button
                  onClick={() => claimKey(sub.subscriptionId)}
                  loading={claiming === sub.subscriptionId}
                  disabled={
                    !sub.eligible ||
                    claiming === sub.subscriptionId ||
                    !sub.subscriptionId ||
                    !sub.plan ||
                    sub.plan === 'unknown'
                  }
                  className={
                    isDark
                      ? 'bg-red-600 text-white border border-red-500 hover:bg-red-500 hover:border-red-400 disabled:opacity-60'
                      : 'bg-red-100 text-slate-900 border border-red-200 hover:bg-red-200 hover:border-red-300 disabled:opacity-60'
                  }
                >
                  Claim free AEM key
                </Button>
              )}
              {/* Persisted miner key and onboarding CTA (surfaces on mobile/return visits) */}
              {sub.claimed && (() => {
                const wallet = session?.user?.address || 'unknown';
                const stored = storedClaims[`${wallet}:${sub.subscriptionId}`];
                if (!stored?.minerKey) return null;
                const onboardingHref = `/register?miner_key=${encodeURIComponent(stored.minerKey)}&from_dimo=1`;
                const regState = registrationStatus[stored.minerKey];
                const registered = regState?.registered;
                return (
                  <div className="mt-3 space-y-2 w-full">
                    <Text className={isDark ? 'text-white' : 'text-slate-900'}>Your AEM miner key:</Text>
                    <div
                      className={`rounded-lg border px-3 py-2 font-mono break-all ${
                        isDark ? 'border-red-400/60 bg-black/30 text-white' : 'border-red-200 bg-white text-slate-900'
                      }`}
                    >
                      {stored.minerKey}
                    </div>
                    <Button
                      disabled={registered === true}
                      className={`border ${
                        isDark
                          ? 'bg-red-600 text-white border-red-500 hover:bg-red-500 hover:border-red-400'
                          : 'bg-red-100 text-slate-900 border-red-200 hover:bg-red-200 hover:border-red-300'
                      } ${registered ? 'opacity-70 cursor-not-allowed' : ''}`}
                      onClick={() => {
                        if (registered) return;
                        // Use SPA navigation to preserve session/fingerprint while onboarding.
                        void router.push(onboardingHref);
                      }}
                    >
                      {registered ? 'Registered successfully' : 'Start onboarding'}
                    </Button>
                  </div>
                );
              })()}
            </Card>
          ))}
        </Grid>
      </Card>
    </main>
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
  return { props: {} };
};
