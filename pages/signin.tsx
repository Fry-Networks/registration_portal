import { Button } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import algosdk from 'algosdk';

const algodClient = new algosdk.Algodv2(
  "",
  "https://mainnet-api.algonode.cloud",
  ""
);


export default function SignIn() {
  const { activeAccount, signTransactions } = useWallet();
  const [isAuthenticating, setIsAuthenticating] = useState(false);

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
      const signedTxns = await signTransactions([algosdk.encodeUnsignedTransaction(txn)]);
      console.log('Signed transaction:', signedTxns);
      if (signedTxns && signedTxns.length > 0) {
        const decodedTxn = algosdk.decodeSignedTransaction(signedTxns[0]);
        console.log('Decoded transaction:', decodedTxn);
        if (decodedTxn.sig) {
          const signature = Buffer.from(decodedTxn.sig).toString('base64');

          await signIn('wallet', {
            address: activeAccount.address,
            signature,
            nonce,
            callbackUrl: '/',
          });
        } else {
          throw new Error('Decoded transaction does not contain a signature');
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

  return (
    <div>
      <h1>Sign In</h1>
      {activeAccount ? (
        <Button onClick={handleWalletAuth} disabled={isAuthenticating}>
          {isAuthenticating ? 'Authenticating...' : 'Sign in with Wallet'}
        </Button>
      ) : (
        <p>Please connect your wallet first</p>
      )}

    </div>
  );
}