import { useWallet } from '@txnlab/use-wallet-react';
import { useDevWallet } from '../hooks/UseDevWallet';
import { Button, Flex, TextInput, Title } from '@tremor/react';
import { signOut, useSession } from 'next-auth/react';
import algosdk from 'algosdk';
import { useEffect, useMemo, useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useToastContext } from '../hooks/ToastContext';
// PoC wallet removed; no need to derive wallet from mnemonic

interface SignInProps {
  signed?: boolean;
}

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function SignIn({ signed }: SignInProps) {
  const router = useRouter();
  const { devConnect, devAccount, algodClient: devAlgodClient } = useDevWallet();
  const { activeAccount, algodClient, wallets, signTransactions } = useWallet();
  const activeWallet = wallets.find(w => w.isActive);
  const { data: session, status } = useSession();
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
            await router.push(res.url);
          } else {
            await router.push(callbackUrl);
          }
        } else {
          throw new Error('Failed to sign the transaction');
        }
      } catch (error) {
        console.error('Error signing message:', error);
      } finally {
        setIsAuthenticating(false);
      }
    } else {
      if (!activeAccount) {
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

        // Create a transaction to sign
        const suggestedParams = await algodClient.getTransactionParams().do();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          sender: activeAccount.address,
          receiver: activeAccount.address,
          amount: 0,
          note: new Uint8Array(Buffer.from(message)),
          suggestedParams
        });

        // Sign the transaction
        const unsignedTxn = algosdk.encodeUnsignedTransaction(txn);

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
              ? await signTransactions(
                  [unsignedTxn],
                  {
                    message: 'Sign in to Fry Dashboard'
                  } as any
                )
              : await signTransactions([unsignedTxn]);

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
        if (!signedBytes) {
          toast.info({
            heading: 'Wallet Request Pending',
            message:
              'Approve the sign-in request in your wallet. Retrying once...'
          });
          signedBytes = await collectSignature(true);
        }

        if (!signedBytes) {
          toast.error({
            heading: 'Signature Required',
            message:
              'We did not receive a signature. Reopen Pera/WalletConnect and try again.'
          });
          setIsAuthenticating(false);
          return;
        }

        const signedTxnBase64 = Buffer.from(signedBytes).toString('base64');
        console.log('Sending to server:', {
          address: activeAccount.address,
          signedTxn: signedTxnBase64,
          nonce
        });

        const callbackUrl = (router.query.callbackUrl as string) || '/';
        const res = await signIn('wallet', {
          address: activeAccount.address,
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
          toast.error({
            heading: 'Sign In Failed',
            message: res.error
          });
        } else if (res?.url) {
          await router.push(res.url);
        } else {
          await router.push(callbackUrl);
        }
      } catch (error) {
        console.error('Error signing message:', error);
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
    () => (devMode ? devAccount?.addr : activeAccount?.address) || null,
    [devAccount?.addr, activeAccount?.address]
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

  const checkUser = async () => {
    if (!connectedWalletAddress) {
      return;
    }

    const result = await fetch('api/check-user', {
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
  };

  // PoC wallet removed; no wallet generation needed

  useEffect(() => {
    checkUser();
  }, [connectedWalletAddress]);

  useEffect(() => {
    if (session && session.user && !session.user.email) {
      signOut();
    }
  }, [session]);

  useEffect(() => {
    if (status !== 'authenticated' || !session?.user?.address) return;
    if (!connectedWalletAddress || session.user.address !== connectedWalletAddress) {
      setIsAuthenticating(false);
      void signOut({ redirect: false });
    }
  }, [status, session?.user?.address, connectedWalletAddress]);

  return !devConnect && !activeAccount ? (
    <></>
  ) : (
    <div className="w-full">
      <Flex flexDirection="col" className="w-full">
        <Title className="text-white px-2 text-center">
          {!session || !isSessionWallet
            ? 'Please click Sign in button to sign with the currently connected wallet.'
            : 'You are signed successfully, click Go to Dashboard to onboard your devices.'}
        </Title>
        {isNew && (
          <div className="mt-4">
            <div>
              <label className="block mb-2 text-white">
                Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter Email Address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              {errors.email && (
                <span className="text-red-500 text-sm">{errors.email}</span>
              )}
            </div>
            <div>
              <label className="block mb-2 mt-2 text-white">
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter First Name"
                value={first_name}
                onChange={(e) => setFirstName(e.target.value)}
              />
              {errors.firstName && (
                <span className="text-red-500 text-sm">{errors.firstName}</span>
              )}
            </div>
            <div>
              <label className="block mb-2 mt-2 text-white">
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded sm:min-w-[400px]"
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
              className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={() => handleWalletAuth()}
              disabled={isAuthenticating || !connectedWalletAddress}
            >
              {isAuthenticating ? 'Authenticating...' : 'Sign In'}
            </Button>
          ) : (
            <Link href="/devices">
              <Button className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600">
                Go to Dashboard
              </Button>
            </Link>
          )}
        </div>
      </Flex>
    </div>
  );
}
