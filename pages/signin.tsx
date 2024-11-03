import { Button, Flex, Title } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import algosdk from 'algosdk';
import { useDevWallet } from '../hooks/UseDevWallet';

const algodClient = new algosdk.Algodv2(
  '',
  'https://mainnet-api.algonode.cloud',
  ''
);

export default function SignIn() {
  const { activeAccount, signTransactions } = useWallet();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const { devConnect } = useDevWallet();

  async function handleWalletAuth() {
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

  return (
    <Flex flexDirection="col" alignItems="center" justifyContent="center">
      <Title className="mt-10 mb-20" style={{ fontSize: '30px' }}>
        Sign in
      </Title>
      {activeAccount || devConnect ? (
        <Button onClick={handleWalletAuth} disabled={isAuthenticating}>
          {isAuthenticating ? 'Authenticating...' : 'Sign in with Wallet'}
        </Button>
      ) : (
        <p>Please connect your wallet first</p>
      )}
    </Flex>
  );
}