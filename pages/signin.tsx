import { Button, Flex, Title } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet-react';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import algosdk from 'algosdk';
import { useDevWallet } from '../hooks/UseDevWallet';
import { useRouter } from 'next/router';

const algodClient = new algosdk.Algodv2(
  '',
  'https://mainnet-api.algonode.cloud',
  ''
);

export default function SignIn() {
  const router = useRouter();
  const { activeAccount, signTransactions } = useWallet();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isNewUser, setIsNewUser] = useState(false);
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [mnemonic, setMnemonic] = useState('');
  const { devConnect } = useDevWallet();

  const checkUser = async () => {
    if (!activeAccount) {
      return;
    }

    const res = await fetch('/api/check-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address: activeAccount.address })
    });

    const { isNew } = await res.json();
    console.log('Check User: ' + isNew);
    setIsNewUser(isNew);
  };

  useEffect(() => {
    checkUser();
  }, [activeAccount]);

  async function handleWalletAuth() {
    if (!activeAccount) return;

    setIsAuthenticating(true);
    try {
      const nonce = Math.floor(Math.random() * 1000000).toString();
      const message = `Sign this message to prove you own the wallet: ${nonce}`;
      console.log('Signing message:', message);

      const suggestedParams = await algodClient.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAccount.address,
        receiver: activeAccount.address,
        amount: 0,
        note: new Uint8Array(Buffer.from(message)),
        suggestedParams
      });

      const signedTxn = await signTransactions([
        algosdk.encodeUnsignedTransaction(txn)
      ]);

      if (signedTxn && signedTxn.length > 0 && signedTxn[0]) {
        const first = signedTxn[0] as Uint8Array; // guarded non-null
        const signedTxnBase64 = Buffer.from(first).toString('base64');

        // Check if user is new

        if (isNewUser) {
          // First-time sign-in
          if (!email || !firstName || !lastName || !mnemonic) {
            alert('Please fill in all required fields');
            setIsAuthenticating(false);
            return;
          }
        }

        // Sign in using NextAuth
        const callbackUrl =
          (router.query.callbackUrl as string) || '/';
        const res = await signIn('wallet', {
          address: activeAccount.address,
          signedTxn: signedTxnBase64,
          nonce,
          email,
          first_name: firstName,
          last_name: lastName,
          mnemonic,
          redirect: false,
          callbackUrl
        });
        if (res?.error) {
          console.error('NextAuth signIn error:', res.error);
        } else if (res?.url) {
          // Respect returned url or fallback
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
  }

  return (
    <Flex flexDirection="col" alignItems="center" justifyContent="center">
      <Title className="mt-10 mb-20" style={{ fontSize: '30px' }}>
        Sign in
      </Title>
      {activeAccount || devConnect ? (
        <>
          {isNewUser && (
            <>
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <input
                type="text"
                placeholder="First Name"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Last Name"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
              <input
                type="text"
                placeholder="Wallet Mnemonic"
                value={mnemonic}
                onChange={(e) => setMnemonic(e.target.value)}
              />
            </>
          )}
          <Button onClick={handleWalletAuth} disabled={isAuthenticating}>
            {isAuthenticating ? 'Authenticating...' : 'Sign in with Wallet'}
          </Button>
        </>
      ) : (
        <p>Please connect your wallet first</p>
      )}
    </Flex>
  );
}
