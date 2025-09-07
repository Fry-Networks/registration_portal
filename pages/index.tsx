import { Flex, Title } from '@tremor/react';
import bgImg from '../assets/background.png';
import Image from 'next/image';
import { useDevWallet } from '../hooks/UseDevWallet';
import { useWallet } from '@txnlab/use-wallet';
import { signIn, useSession } from 'next-auth/react';
import { useEffect } from 'react';
import SignIn from '../components/SignIn';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

export default function IndexPage() {
  const { devConnect } = useDevWallet();
  const { activeAccount } = useWallet();
  const { data: session, status } = useSession();

  return (
    <main className="w-full">
      <div className="relative flex">
        <Image
          src={bgImg}
          className="w-full h-[50vh] object-cover"
          alt="Background Image"
          priority
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-6"
        >
          <Title className="text-white text-3xl sm:text-5xl w-full text-center px-2">
            Register and Manage Your FRY Miners and Nodes with Fry Networks
          </Title>
          <p className="text-lg text-center px-2 sm:px-20 text-gray-300">
            Welcome to the Fry Networks Dashboard. Use this platform to
            seamlessly register, verify, and manage your miners and nodes. Stay
            connected to the Fry ecosystem and unlock rewards while contributing
            to the decentralized future.
          </p>
        </Flex>
      </div>
      <Flex flexDirection="col" className="mt-10">
        {!((devMode && devConnect) || activeAccount) ? (
          <Title className="text-white text-center px-2">
            Please connect your wallet to onboard your devices to FRY NETWORKS
          </Title>
        ) : (
          <SignIn />
        )}
      </Flex>
    </main>
  );
}
