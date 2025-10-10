import { Button, Flex, Title } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet-react';
import { signIn } from 'next-auth/react';
import { useEffect, useState } from 'react';
import algosdk from 'algosdk';
import { useDevWallet } from '../hooks/UseDevWallet';
import { useRouter } from 'next/router';
import { useToastContext } from '../hooks/ToastContext';

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
  const toast = useToastContext();

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

      const suggestedParams = await algodClient.getTransactionParams().do();
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        sender: activeAccount.address,
        receiver: activeAccount.address,
        amount: 0,
        note: new Uint8Array(Buffer.from(message)),
        suggestedParams
      });

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
            '[pages/signin] signTransactions failed',
            includeMessage ? 'with message' : 'default',
            error
          );
          return null;
        }
      };

      let signedBytes = await collectSignature(false);

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

      if (isNewUser) {
        // First-time sign-in
        if (!email || !firstName || !lastName || !mnemonic) {
          alert('Please fill in all required fields');
          setIsAuthenticating(false);
          return;
        }
      }

      // Sign in using NextAuth
      const callbackUrl = (router.query.callbackUrl as string) || '/';
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
        message:
          error instanceof Error ? error.message : 'Unexpected error occurred.'
      });
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
