import PageShell from "../components/PageShell";
import { Button, Flex, Title } from '@tremor/react';
import { signIn } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { useDevWallet } from '../hooks/UseDevWallet';
import { useRouter } from 'next/router';
import { useToastContext } from '../hooks/ToastContext';
import { useWalletActions } from '../lib/wallet/useWalletActions';
import { buildPaymentTxn } from '../lib/wallet/transactions';
import { WalletRequestInFlightError, isWalletRequestActive } from '../lib/wallet/requestCoordinator.client';
export default function SignIn() {
  const router = useRouter();
  const {
    activeAddress: walletAddress,
    signTransactions
  } = useWalletActions();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const {
    devConnect
  } = useDevWallet();
  const toast = useToastContext();
  const checkUser = useCallback(async () => {
    if (!walletAddress) {
      return;
    }
    const res = await fetch('/api/check-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address: walletAddress
      })
    });
    const {
      isNew
    } = await res.json();
    console.log('Check User: ' + isNew);
    setIsNewUser(isNew);
  }, [walletAddress]);
  useEffect(() => {
    checkUser();
  }, [checkUser]);

  async function handleWalletAuth() {
    if (!walletAddress) {
      toast.error({
        heading: 'Wallet Not Connected',
        message: 'Connect your wallet before signing in.'
      });
      return;
    }
    setIsAuthenticating(true);
    try {
      const nonce = Math.floor(Math.random() * 1000000).toString();
      const message = `Sign this message to prove you own the wallet: ${nonce}`;
      console.log('Signing message:', message);
      const noteBytes = new TextEncoder().encode(message);
      const unsignedTxn = await buildPaymentTxn({
        sender: walletAddress,
        receiver: walletAddress,
        amount: 0,
        useMicroAlgos: true,
        note: noteBytes
      });
      const coerceToBytes = (value: unknown): Uint8Array | null => {
        if (!value) return null;
        if (value instanceof Uint8Array) return value;
        if (typeof value === 'string') {
          try {
            const buf = Buffer.from(value, 'base64');
            return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
          } catch (error) {
            console.warn('Failed to decode base64 signature', error);
            return null;
          }
        }
        return null;
      };
      const collectSignature = async (includeMessage: boolean): Promise<Uint8Array | null> => {
        try {
          const payload = includeMessage ? await signTransactions([unsignedTxn], {
            message: 'Sign in to the Fry Dashboard'
          } as any) : await signTransactions([unsignedTxn]);
          if (!payload?.length) {
            return null;
          }
          for (const entry of payload) {
            const bytes = coerceToBytes(entry);
            if (bytes) {
              return bytes;
            }
          }
          return null;
        } catch (error) {
          if (error instanceof WalletRequestInFlightError) {
            toast.info({
              heading: 'Wallet Request In Progress',
              message: 'Finish or cancel the current wallet prompt, then retry.'
            });
            return null;
          }
          console.error('[pages/signin] signTransactions failed', includeMessage ? 'with message' : 'default', error);
          return null;
        }
      };
      let signedBytes = await collectSignature(false);
      if (!signedBytes) {
        toast.info({
          heading: 'Wallet Request Pending',
          message: 'Approve the sign-in request in your wallet. Retrying once...'
        });
        signedBytes = await collectSignature(true);
      }
      if (!signedBytes) {
        // Avoid double messaging when another wallet prompt is already in flight.
        if (!isWalletRequestActive()) {
          toast.error({
            heading: 'Signature Required',
            message: 'We did not receive a signature. Reopen Pera/WalletConnect and try again.'
          });
        }
        setIsAuthenticating(false);
        return;
      }
      const signedTxnBase64 = Buffer.from(signedBytes).toString('base64');
      if (isNewUser) {
        // First-time sign-in
        if (!email || !firstName || !lastName) {
          alert('Please fill in all required fields');
          setIsAuthenticating(false);
          return;
        }
      }

      // Sign in using NextAuth
      const callbackUrl = router.query.callbackUrl as string || '/';
      const res = await signIn('wallet', {
        address: walletAddress,
        signedTxn: signedTxnBase64,
        nonce,
        email,
        first_name: firstName,
        last_name: lastName,
        redirect: false,
        callbackUrl
      });
      if (res?.error) {
        console.error('NextAuth signIn error:', res.error);
        toast.error({
          heading: 'Sign In Failed',
          message: res.error
        });
      } else if (res?.url) {
        // Respect returned url or fallback
        await router.push(res.url);
      } else {
        await router.push(callbackUrl);
      }
    } catch (error) {
      console.error('Error signing message:', error);
      toast.error({
        heading: 'Sign In Failed',
        message: error instanceof Error ? error.message : 'Unexpected error occurred.'
      });
    } finally {
      setIsAuthenticating(false);
    }
  }
  return (
    <PageShell title="Sign In" breadcrumb={false}>
      <div className="min-h-[70vh] flex items-center justify-center px-4">
        <div className="w-full max-w-md mx-auto">
          <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-8 shadow-token-lg text-center">
            <h1 className="text-3xl font-display font-bold text-ink mb-2">
              Sign In
            </h1>
            <p className="text-sm text-ink-secondary mb-space-8">
              Connect your wallet to access the dashboard.
            </p>
            <p className="text-xs text-green-600 mb-space-6 font-medium">
              We will never ask for your seed phrase or private key.
            </p>

            {walletAddress || devConnect ? (
              <div className="space-y-4 text-left">
                {isNewUser && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-sm font-medium text-ink-secondary mb-1 block">Email</label>
                      <input
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={e => setEmail(e.target.value)}
                        className="w-full bg-surface-strong border border-divider rounded-token-md px-4 py-2.5 text-ink focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-ink-secondary mb-1 block">First Name</label>
                      <input
                        type="text"
                        placeholder="Samuel"
                        value={firstName}
                        onChange={e => setFirstName(e.target.value)}
                        className="w-full bg-surface-strong border border-divider rounded-token-md px-4 py-2.5 text-ink focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium text-ink-secondary mb-1 block">Last Name</label>
                      <input
                        type="text"
                        placeholder="Fry"
                        value={lastName}
                        onChange={e => setLastName(e.target.value)}
                        className="w-full bg-surface-strong border border-divider rounded-token-md px-4 py-2.5 text-ink focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition"
                      />
                    </div>
                  </div>
                )}
                <button
                  onClick={handleWalletAuth}
                  disabled={isAuthenticating}
                  className="w-full bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-ink px-6 py-3 rounded-token-md font-semibold transition shadow-token-glow"
                >
                  {isAuthenticating ? 'Authenticating...' : 'Sign in with Wallet'}
                </button>
              </div>
            ) : (
              <div className="py-space-6">
                <p className="text-ink-secondary text-sm mb-space-4">
                  No wallet connected.
                </p>
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-surface-strong border border-divider mb-space-4">
                  <svg className="w-8 h-8 text-ink-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 9V7a5 5 0 00-10 0v2M12 15v3m-6 0h12a2 2 0 002-2v-5a2 2 0 00-2-2H6a2 2 0 00-2 2v5a2 2 0 002 2z" />
                  </svg>
                </div>
                <p className="text-xs text-ink-muted">
                  Use the wallet button in the header to connect.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}