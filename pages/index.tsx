import { Flex, Title } from '@tremor/react';
import ConnectMenu from '../components/connect';
import bgImg from '../assets/background.png';
import Image from 'next/image';

export default function IndexPage() {
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
    </main>
  );
}
