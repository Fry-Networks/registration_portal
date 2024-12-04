import { useWallet } from '@txnlab/use-wallet';
import { useDevWallet } from '../hooks/UseDevWallet';
import { Button, Flex, Title } from '@tremor/react';
import { useSession } from 'next-auth/react';
import algosdk from 'algosdk';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Link from 'next/link';

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

  console.log(`Session: ${session}`);

  async function handleWalletAuth() {
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
          await signIn('wallet', {
            address: devAccount.addr,
            signedTxn: signedTxnBase64,
            nonce,
            callbackUrl: '/'
          });
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

          // Send this information to the server for verification
          await signIn('wallet', {
            address: activeAccount.address,
            signedTxn: signedTxnBase64,
            nonce,
            callbackUrl: '/'
          });
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

  return !devConnect && !activeAccount ? (
    <></>
  ) : (
    <div className="w-full">
      <Flex flexDirection="col" className="w-full">
        <Title className="text-white">
          {!session
            ? 'Please click signIn button to signin with your wallet address'
            : 'You are signed successfully, click go to Dashboard to onboard your devices'}
        </Title>
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
