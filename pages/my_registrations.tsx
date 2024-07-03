import { Title, Text } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet';
import { useSession, signIn, signOut, getSession } from 'next-auth/react';
import { useEffect } from 'react';
import clientPromise from '../lib/mongoclient';

export default function MyRegistrationsPage({ userWallet }: { userWallet: any }) {
  const { data: session, status } = useSession();
  const { activeAccount } = useWallet();

  useEffect(() => {
    if (activeAccount && !session) {
      signIn('wallet');
    }
  }, [activeAccount, session]);

  if (status === 'loading') {
    return <p>Loading...</p>;
  }

  return (
    <main className="p-4 md:p-10 mx-auto max-w-7xl">
      {session ? (
        <>
          <Title className='mb-20'>My Registrations</Title>
          {/* @ts-ignore */}
          <Text>Wallet address: {session.user.address}</Text>
          <Text>Wallet addr : {activeAccount?.address}</Text>
          {/* Display user wallet information here */}
          <button onClick={() => signOut()}>Sign out</button>
        </>
      ) : (
        <Title className='mb-20'>Please connect your wallet and authenticate</Title>
      )}
    </main>
  );
}

export async function getServerSideProps(context: any) {
  const session = await getSession(context);
  console.log(session);
  if (!session || !session.user.address) {
    return {
      props: {},
    };
  }

  try {
    return {
      props: { userWallet: session.user.address },
    };
    const client = await clientPromise;
    const db = client.db('main');
    
    const wallet = null;
    //await db.collection('wallets').findOne({ wallet: session.user.address });
    
    if (!wallet) {
      return {
        props: {},
      };
    } else {
      return {
        props: { userWallet: JSON.parse(JSON.stringify(wallet)) },
      };
    }
  } catch (e) {
    console.error(e);
    return {
      props: {},
    };
  }
}