import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, Button, Text, Badge, Flex, Textarea } from '@tremor/react';
import dynamic from 'next/dynamic';

// Dynamic import the SDK components client-side only.
const DimoAuthProvider = dynamic(
  async () => {
    const mod = await import('@dimo-network/login-with-dimo');
    return mod.DimoAuthProvider;
  },
  { ssr: false }
);

const LoginWithDimo = dynamic(
  async () => {
    const mod = await import('@dimo-network/login-with-dimo');
    return mod.LoginWithDimo;
  },
  { ssr: false }
);

type DimoLoginSectionProps = {
  onSync: (token: string) => Promise<void>;
  syncing: boolean;
  connected: boolean;
  onTokenChange?: (token: string) => void;
  token?: string;
  className?: string;
  onAuthChange?: (authenticated: boolean) => void;
};

// Lightweight status badge renderer.
const StatusBadge = ({ connected }: { connected: boolean }) => (
  <Badge color={connected ? 'green' : 'gray'}>{connected ? 'Ready' : 'Loading'}</Badge>
);

type DimoAuthContentProps = {
  onSync: (token: string) => Promise<void>;
  syncing: boolean;
  token?: string;
  onTokenChange?: (token: string) => void;
  ready: boolean;
  sdkError: string | null;
  setSdkError: (val: string | null) => void;
  onAuthChange?: (authenticated: boolean) => void;
};

// Child component so hooks are used within a Provider.
const DimoAuthContent = ({
  onSync,
  syncing,
  token,
  onTokenChange,
  ready,
  sdkError,
  setSdkError,
  onAuthChange
}: DimoAuthContentProps) => {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const { getValidJWT, isAuthenticated } =
    (require('@dimo-network/login-with-dimo') as any).useDimoAuthState?.() ?? {};

  // Notify parent when auth state changes so it can toggle UI affordances.
  useEffect(() => {
    onAuthChange?.(Boolean(isAuthenticated));
  }, [isAuthenticated, onAuthChange]);

  const syncFromSdk = useCallback(async () => {
    if (typeof getValidJWT !== 'function') {
      setSdkError('DIMO SDK not ready to provide JWT');
      return;
    }
    const jwt = await getValidJWT();
    if (!jwt) {
      setSdkError('No user JWT available; please login with DIMO first.');
      return;
    }
    setSdkError(null);
    await onSync(jwt);
  }, [getValidJWT, onSync, setSdkError]);

  return (
    <>
      <div className="dimo-login-button-wrap">
        <LoginWithDimo
          mode="popup"
          onSuccess={() => setSdkError(null)}
          onError={(err: any) => setSdkError(err?.message || 'DIMO login failed')}
          permissionTemplateId={undefined}
        />
      </div>
      {isAuthenticated && (
        <Button
          onClick={syncFromSdk}
          loading={syncing}
          disabled={!ready || syncing}
          className="w-full bg-red-600 text-white border border-red-500 hover:bg-red-500 hover:border-red-400"
        >
          Sync DIMO subscriptions
        </Button>
      )}
      {process.env.NEXT_PUBLIC_DEV_MODE === 'true' && (
        <>
          <Text className="text-sm text-gray-500 dark:text-gray-400">
            Need to debug? Paste a JWT directly and sync:
          </Text>
          <Textarea
            value={token ?? ''}
            onChange={(e) => onTokenChange?.(e.target.value)}
            placeholder="Paste userJwt from getValidJWT()"
            rows={3}
          />
          <Flex justifyContent="start" alignItems="center" className="gap-3">
            <Button onClick={() => token && onSync(token)} loading={syncing} disabled={!token || syncing}>
              Sync subscriptions (manual JWT)
            </Button>
            {sdkError && <Text className="text-red-500 text-sm">{sdkError}</Text>}
          </Flex>
        </>
      )}
      <style jsx global>{`
        .dimo-login-button-wrap button {
          width: auto !important;
          min-width: 260px;
          max-width: 100%;
          background-color: #dc2626 !important;
          color: #ffffff !important;
          border: 1px solid #ef4444 !important;
          border-radius: 9999px !important;
          padding: 0.65rem 1.25rem !important;
          display: inline-flex !important;
          align-items: center;
          justify-content: center;
          transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.1s ease !important;
        }
        .dimo-login-button-wrap button:hover {
          background-color: #ef4444 !important;
          border-color: #f87171 !important;
          transform: translateY(-1px) !important;
        }
        .dimo-login-button-wrap button:disabled {
          opacity: 0.6 !important;
          cursor: not-allowed !important;
        }
      `}</style>
    </>
  );
};

const DimoLoginSection = ({
  onSync,
  syncing,
  connected,
  token,
  onTokenChange,
  className,
  onAuthChange
}: DimoLoginSectionProps) => {
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  const clientId = process.env.NEXT_PUBLIC_DIMO_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_DIMO_REDIRECT_URI;
  const env = process.env.NEXT_PUBLIC_DIMO_ENV || 'production';

  const missingEnv = useMemo(() => !clientId || !redirectUri, [clientId, redirectUri]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      if (missingEnv || !clientId || !redirectUri) return;
      try {
        const mod = await import('@dimo-network/login-with-dimo');
        // Initialize SDK once.
        if (typeof mod.initializeDimoSDK === 'function') {
          mod.initializeDimoSDK({
            clientId: clientId as string,
            redirectUri: redirectUri as string,
            environment: env as 'development' | 'production',
            options: {
              forceEmail: true
            }
          });
        }
        if (!cancelled) setReady(true);
      } catch (err: any) {
        console.error('Failed to initialize DIMO SDK', err);
        if (!cancelled) setSdkError(err?.message || 'DIMO SDK init failed');
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
  }, [clientId, redirectUri, env, missingEnv]);

  if (missingEnv) {
    return (
      <Card>
        <Text>Missing DIMO client configuration. Please set NEXT_PUBLIC_DIMO_CLIENT_ID and NEXT_PUBLIC_DIMO_REDIRECT_URI.</Text>
      </Card>
    );
  }

  const themedCardClasses = [
    'relative overflow-hidden border border-red-500/30 bg-[#0b0b0f] bg-[radial-gradient(circle_at_top,_rgba(248,113,113,0.12),_transparent_60%)]',
    'shadow-[0_24px_40px_-24px_rgba(248,113,113,0.55)]',
    'backdrop-blur-sm'
  ]
    .concat(className ? [className] : [])
    .join(' ');

  const statusReady = ready && connected;

  return (
    <Card className={`space-y-4 text-white ${themedCardClasses}`}>
      <Flex justifyContent="between" alignItems="center">
        <div className="space-y-1">
          <Text className="font-semibold">Click &quot;Continue with DIMO&quot; below, login then sync your subscriptions, and claim one free Fry Edge Miner (FEM) key per eligible subscription.</Text>
        </div>
        <StatusBadge connected={statusReady} />
      </Flex>
      <DimoAuthProvider>
        <DimoAuthContent
          onSync={onSync}
          syncing={syncing}
          token={token}
          onTokenChange={onTokenChange}
          ready={ready}
          sdkError={sdkError}
          setSdkError={setSdkError}
          onAuthChange={onAuthChange}
        />
      </DimoAuthProvider>
    </Card>
  );
};

export default DimoLoginSection;

