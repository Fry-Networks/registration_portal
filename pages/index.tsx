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
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-6"
        >
          <Title className="text-white text-5xl">
            Onboard your miners to Fry networks
          </Title>
          <p className="text-lg">Explanation for about onboarding miners</p>
        </Flex>
      </div>
      <Flex flexDirection="col" className="mt-10">
        {!((devMode && devConnect) || activeAccount) ? (
          <Title className="text-white">
            Please connect your wallet to onboard your devices to FRY NETWORKS
          </Title>
        ) : (
          <SignIn />
        )}
      </Flex>
    </main>
  );
}
