import { useWallet } from '@txnlab/use-wallet';
import { useDevWallet } from '../hooks/UseDevWallet';
import { Button, Flex, TextInput, Title } from '@tremor/react';
import { signOut, useSession } from 'next-auth/react';
import algosdk from 'algosdk';
import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';
import GenerateWallet from './modals/GenerateWallet';
// PoC wallet removed; no need to derive wallet from mnemonic

interface SignInProps {
  signed?: boolean;
}

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function SignIn({ signed }: SignInProps) {
  const { devConnect, devAccount, algodClient } = useDevWallet();
  const { activeAccount, signTransactions } = useWallet();
  const { data: session, status } = useSession();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [email, setEmail] = useState('');
  const [first_name, setFirstName] = useState('');
  const [last_name, setLastName] = useState('');
  // Removed PoC wallet requirement
  const [errors, setErrors] = useState<{ [key: string]: string }>({});

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
        const suggestedParams = await algodClient.getTransactionParams().do();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: devAccount.addr,
          to: devAccount.addr,
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
          if (isNew) {
            await signIn('wallet', {
              address: devAccount.addr,
              email: email,
              first_name: first_name,
              last_name: last_name,
              signedTxn: signedTxnBase64,
              nonce,
              callbackUrl: '/'
            });
          } else {
            await signIn('wallet', {
              address: devAccount.addr,
              signedTxn: signedTxnBase64,
              nonce,
              callbackUrl: '/'
            });
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
      if (!activeAccount) return;

      setIsAuthenticating(true);
      try {
        const nonce = Math.floor(Math.random() * 1000000).toString();
        const message = `Sign this message to prove you own the wallet: ${nonce}`;
        console.log('Signing message:', message);

        // Create a transaction to sign
        const suggestedParams = await algodClient.getTransactionParams().do();
        const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
          from: activeAccount.address,
          to: activeAccount.address,
          amount: 0,
          note: new Uint8Array(Buffer.from(message)),
          suggestedParams
        });

        // Sign the transaction
        const signedTxn = await signTransactions([
          algosdk.encodeUnsignedTransaction(txn)
        ]);
        console.log('Signed transaction:', signedTxn);

        if (signedTxn && signedTxn.length > 0) {
          const signedTxnBase64 = Buffer.from(signedTxn[0]).toString('base64');
          console.log('Sending to server:', {
            address: activeAccount.address,
            signedTxn: signedTxnBase64,
            nonce
          });

          if (isNew) {
            await signIn('wallet', {
              address: activeAccount.address,
              email: email,
              first_name: first_name,
              last_name: last_name,
              signedTxn: signedTxnBase64,
              nonce,
              callbackUrl: '/'
            });
          } else {
            await signIn('wallet', {
              address: activeAccount.address,
              signedTxn: signedTxnBase64,
              nonce,
              callbackUrl: '/'
            });
          }
        } else {
          throw new Error('Failed to sign the transaction');
        }
      } catch (error) {
        console.error('Error signing message:', error);
      } finally {
        setIsAuthenticating(false);
      }
    }
  }

  const checkUser = async () => {
    if (!devAccount && !activeAccount) {
      return;
    }

    const result = await fetch('api/check-user', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address: devMode ? devAccount?.addr : activeAccount?.address
      })
    });

    const { isNew } = await result.json();
    console.log('Is New: ' + isNew);
    setIsNew(isNew);
  };

  // PoC wallet removed; no wallet generation needed

  useEffect(() => {
    checkUser();
  }, [devAccount, activeAccount]);

  useEffect(() => {
    if (session && session.user && !session.user.email) {
      signOut();
    }
  }, [session]);

  return !devConnect && !activeAccount ? (
    <></>
  ) : (
    <div className="w-full">
      <Flex flexDirection="col" className="w-full">
        <Title className="text-white px-2 text-center">
          {!session
            ? 'Please click Sign in button to signin with your wallet address'
            : 'You are signed successfully, click go to Dashboard to onboard your devices'}
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
          {!session ? (
            <Button
              className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={() => handleWalletAuth()}
              disabled={isAuthenticating}
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
