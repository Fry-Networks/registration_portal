import { useWallet } from '@txnlab/use-wallet-react';
import { useDevWallet } from '../hooks/UseDevWallet';
import { Button, Flex, TextInput, Title } from '@tremor/react';
import { signOut, useSession } from 'next-auth/react';
import algosdk from 'algosdk';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useToastContext } from '../hooks/ToastContext';
import { useWalletActions } from '../lib/wallet/useWalletActions';
import { buildPaymentTxn } from '../lib/wallet/transactions';
import { WalletRequestInFlightError, isWalletRequestActive } from '../lib/wallet/requestCoordinator.client';
import { shouldForceSignOut } from '../lib/wallet/sessionGuard';
import { useTheme } from 'next-themes';
// PoC wallet removed; no need to derive wallet from mnemonic

interface SignInProps {
  signed?: boolean;
}

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

// B12: never leave the user on an infinite "Authenticating..." spinner — cap
// every wallet signature request at a hard timeout, then surface a retry path.
const SIGN_IN_TIMEOUT_MS = 45_000;
class SignInTimeoutError extends Error {}
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new SignInTimeoutError('SIGN_IN_TIMEOUT')), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

export default function SignIn({ signed }: SignInProps) {
  const router = useRouter();
  const { devConnect, devAccount, algodClient: devAlgodClient } = useDevWallet();
  const { activeAccount, wallets, isReady: isWalletReady } = useWallet();
  const { activeAddress: walletAddress, signTransactions } = useWalletActions();
  const activeWallet = wallets.find((wallet) => wallet.isActive);
  const { data: session, status } = useSession();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [email, setEmail] = useState('');
  const [first_name, setFirstName] = useState('');
  const [last_name, setLastName] = useState('');
  // Removed PoC wallet requirement
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const toast = useToastContext();

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) newErrors.email = 'Invalid email address';
    if (!first_name) newErrors.firstName = 'First name is required';
    if (!last_name) newErrors.lastName = 'Last name is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // PoC wallet generation removed

  async function handleWalletAuth() {
    if (isNew && !validateForm()) {
      return;
    }

    if (devMode) {
      if (!devConnect || !devAccount) return;

      const nonce = Math.floor(Math.random() * 1000000).toString();
      const message = `Sign this message to prove you own the wallet: ${nonce}`;

      try {
        const suggestedParams = await devAlgodClient.getTransactionParams().do();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: devAccount.addr,
          receiver: devAccount.addr,
          amount: 0,
          note: new Uint8Array(Buffer.from(message)),
          suggestedParams
        });

        const signedTxn = algosdk.signTransaction(txn, devAccount.sk);
        if (signedTxn) {
          const signedTxnBase64 = Buffer.from(signedTxn.blob).toString(
            'base64'
          );
          console.log('Sending to server:', {
            address: devAccount.addr,
            signedTxn: signedTxnBase64,
            nonce
          });

          // Send this information to the server for verification
          const callbackUrl = (router.query.callbackUrl as string) || '/';
          const res = await signIn('wallet', {
            address: devAccount.addr,
            email: isNew ? email : undefined,
            first_name: isNew ? first_name : undefined,
            last_name: isNew ? last_name : undefined,
            signedTxn: signedTxnBase64,
            nonce,
            redirect: false,
            callbackUrl
          });
          if (res?.error) {
            console.error('NextAuth signIn error:', res.error);
          } else if (res?.url) {
            await router.replace(res.url);
          } else {
            await router.replace(callbackUrl);
          }
        } else {
          throw new Error('Failed to sign the transaction');
        }
      } catch (error) {
        const friendlyMessage =
          error instanceof Error ? error.message : JSON.stringify(error ?? {});
        console.error('Error signing message:', friendlyMessage);
        toast.error({
          heading: 'Sign In Failed',
          message: friendlyMessage || 'Unexpected error occurred while signing.'
        });
      } finally {
        setIsAuthenticating(false);
      }
    } else {
      if (!walletAddress) {
        toast.error({
          heading: 'Wallet Not Connected',
          message: 'Connect your wallet before signing in.'
        });
        return;
      }

      setIsAuthenticating(true);
      let signTimedOut = false;
      try {
        const nonce = Math.floor(Math.random() * 1000000).toString();
        const message = `Sign this message to prove you own the wallet: ${nonce}`;
        console.log('Signing message:', message);

        // Create a transaction to sign
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

        const collectSignature = async (
          includeMessage: boolean
        ): Promise<Uint8Array | null> => {
          try {
            const payload = includeMessage
              ? await withTimeout(
                  signTransactions(
                    [unsignedTxn],
                    {
                      message: 'Sign in to Fry Dashboard'
                    } as any
                  ),
                  SIGN_IN_TIMEOUT_MS
                )
              : await withTimeout(signTransactions([unsignedTxn]), SIGN_IN_TIMEOUT_MS);

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
            if (error instanceof SignInTimeoutError) {
              signTimedOut = true;
              toast.error({
                heading: 'Wallet request timed out',
                message:
                  'No response from your wallet within 45 seconds. Open your wallet app (Pera / Defly / GoPlausible), approve or dismiss the pending request, then press Sign In to retry.'
              });
              return null;
            }
            if (error instanceof WalletRequestInFlightError) {
              toast.info({
                heading: 'Wallet Request In Progress',
                message: 'Finish or cancel the active wallet prompt before starting another.'
              });
              return null;
            }
            console.error(
              '[SignIn] signTransactions failed',
              includeMessage ? 'with message' : 'default',
              error
            );
            return null;
          }
        };

        // First attempt: original call signature to preserve desktop behaviour.
        let signedBytes = await collectSignature(false);

        // If the wallet returns nothing (common on WalletConnect mobile), retry once with a metadata message.
        // Skip the automatic retry after a timeout — the user retries manually via the Sign In button.
        if (!signedBytes && !signTimedOut) {
          toast.info({
            heading: 'Wallet Request Pending',
            message:
              'Approve the sign-in request in your wallet. Retrying once...'
          });
          signedBytes = await collectSignature(true);
        }

        if (!signedBytes) {
          // Skip the generic failure toast if another wallet request is already active
          // or the timeout toast was just shown.
          if (!signTimedOut && !isWalletRequestActive()) {
            toast.error({
              heading: 'Signature Required',
              message:
                'We did not receive a signature. Reopen Pera/Defly and try again.'
            });
          }
          setIsAuthenticating(false);
          return;
        }

        const signedTxnBase64 = Buffer.from(signedBytes).toString('base64');
        console.log('Sending to server:', {
          address: walletAddress,
          signedTxn: signedTxnBase64,
          nonce
        });

        const callbackUrl = (router.query.callbackUrl as string) || '/';
        const performSignIn = async (): Promise<Awaited<ReturnType<typeof signIn>>> => {
          return signIn('wallet', {
            address: walletAddress,
            email: isNew ? email : undefined,
            first_name: isNew ? first_name : undefined,
            last_name: isNew ? last_name : undefined,
            signedTxn: signedTxnBase64,
            nonce,
            redirect: false,
            callbackUrl
          });
        };
        let res = await performSignIn();
        if (!res || res.error === 'Failed to fetch') {
          toast.info({
            heading: 'Network hiccup',
            message: 'Retrying sign-in...'
          });
          res = await performSignIn();
        }
        if (res?.error) {
          console.error('NextAuth signIn error:', res.error);
          toast.error({
            heading: 'Sign In Failed',
            message: res.error
          });
        } else if (res?.url) {
          await router.replace(res.url);
        } else {
          await router.replace(callbackUrl);
        }
      } catch (error) {
        const friendlyMessage =
          error instanceof Error ? error.message : JSON.stringify(error ?? {});
        console.error('Error signing message:', friendlyMessage);
        toast.error({
          heading: 'Sign In Failed',
          message: friendlyMessage || 'Unexpected error occurred while signing.'
        });
        toast.error({
          heading: 'Sign In Failed',
          message:
            error instanceof Error ? error.message : 'Unexpected error occurred.'
        });
      } finally {
        setIsAuthenticating(false);
      }
    }
  }

  const connectedWalletAddress = useMemo(
    () => (devMode ? devAccount?.addr : walletAddress) || null,
    [devAccount?.addr, walletAddress]
  );

  const isSessionWallet = Boolean(
    session?.user?.address && connectedWalletAddress && session.user.address === connectedWalletAddress
  );

  useEffect(() => {
    if (connectedWalletAddress) return;
    setIsNew(false);
    setEmail('');
    setFirstName('');
    setLastName('');
    setErrors({});
  }, [connectedWalletAddress]);

  const checkUser = useCallback(async () => {
    if (!connectedWalletAddress) {
      return;
    }

    const result = await fetch('/api/check-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address: connectedWalletAddress
      })
    });

    const { isNew } = await result.json();
    console.log('Is New: ' + isNew);
    setIsNew(isNew);
  }, [connectedWalletAddress]);

  // PoC wallet removed; no wallet generation needed

  useEffect(() => {
    checkUser();
  }, [checkUser]);


  useEffect(() => {
    if (
      shouldForceSignOut({
        status,
        sessionAddress: session?.user?.address ?? null,
        connectedAddress: connectedWalletAddress,
        walletReady: devMode ? true : isWalletReady
      })
    ) {
      setIsAuthenticating(false);
      void signOut({ redirect: false });
    }
  }, [status, session?.user?.address, connectedWalletAddress, isWalletReady]);

  return !devConnect && !walletAddress ? (
    <></>
  ) : (
    // Allow the onboarding form to scroll on smaller devices so the Sign In button stays reachable.
    <div
      className="w-full max-w-xl mx-auto px-4"
      style={{ maxHeight: 'calc(100vh - 140px)', overflowY: 'auto' }}
    >
      <Flex flexDirection="col" className="w-full">
        <Title className={`${isDark ? 'text-white' : 'text-slate-900'} px-2 text-center`}>
          {!session || !isSessionWallet
            ? 'Please click the Sign in button to sign with the currently connected wallet.'
            : 'You are signed in successfully, click "Go to Dashboard" to continue.'}
        </Title>
        {isNew && (
          <div className="mt-4">
            <div>
              <label className={`block mb-2 ${isDark ? 'text-white' : 'text-slate-800'}`}>
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                className="w-full p-2 border border-red-600 rounded text-slate-900"
                placeholder="Enter Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {errors.email && (
                <span className="text-red-500 text-sm">{errors.email}</span>
              )}
            </div>
            <div>
              <label className={`block mb-2 mt-2 ${isDark ? 'text-white' : 'text-slate-800'}`}>
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded text-slate-900"
                placeholder="Enter First Name"
                value={first_name}
                onChange={(e) => setFirstName(e.target.value)}
              />
              {errors.firstName && (
                <span className="text-red-500 text-sm">{errors.firstName}</span>
              )}
            </div>
            <div>
              <label className={`block mb-2 mt-2 ${isDark ? 'text-white' : 'text-slate-800'}`}>
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded sm:min-w-[400px] text-slate-900"
                placeholder="Enter Last Name"
                value={last_name}
                onChange={(e) => setLastName(e.target.value)}
              />
              {errors.lastName && (
                <span className="text-red-500 text-sm">{errors.lastName}</span>
              )}
            </div>
            {/* PoC wallet input removed */}
          </div>
        )}
        <div className="mt-10">
          {!session || !isSessionWallet ? (
            <Button
              className={
                isDark
                  ? 'bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 text-white'
                  : 'bg-red-600 text-white border-red-600 hover:bg-red-700 hover:border-red-700'
              }
              onClick={() => handleWalletAuth()}
              disabled={isAuthenticating || !connectedWalletAddress}
            >
              {isAuthenticating ? 'Authenticating...' : 'Sign In'}
            </Button>
          ) : (
            <Link href="/devices">
              <Button
                className={
                  isDark
                    ? 'bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 text-white'
                    : 'bg-red-600 text-white border-red-600 hover:bg-red-700 hover:border-red-700'
                }
              >
                Go to Dashboard
              </Button>
            </Link>
          )}
        </div>
      </Flex>
    </div>
  );
}
