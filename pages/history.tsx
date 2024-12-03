import { Flex, Title } from '@tremor/react';
import Image from 'next/image';
import bgImg from '../assets/background.png';
import { getSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { Reward } from '../lib/types';
import RewardListItem from '../components/RewardListItem';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export default function History({ rewards }: { rewards: Reward[] }) {
  return (
    <div className="w-full">
      <div className="relative flex">
        <Image
          src={bgImg}
          className="w-full h-[30vh] object-cover"
          alt="Background Image"
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-6"
        >
          <Title className="text-white text-5xl">Reward History</Title>
          <p className="text-lg">
            You can explore the rewards history and manage each reward for
            miners on here.
          </p>
        </Flex>
      </div>
      <div className="mt-6 px-20">
        <Flex className="w-full" flexDirection="col">
          {rewards.map((reward) => {
            return <RewardListItem reward={reward} />;
          })}
        </Flex>
      </div>
    </div>
  );
}

export async function getServerSideProps(context: any) {
  const session = await getSession(context);

  if (!session || !session.user) {
    return {
      props: {}
    };
  }

  const query = context.query;
  if (!query) {
    return {
      props: {}
    };
  }

  const { miner_key } = query;
  console.log(miner_key);

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const rewards = await db
      .collection(testMode ? 'test-rewards' : 'rewards')
      .find({ miner_key: miner_key })
      .limit(30)
      .toArray();

    if (!rewards) {
      return {
        props: {
          rewards: []
        }
      };
    } else {
      return {
        props: {
          rewards: JSON.parse(JSON.stringify(rewards))
        }
      };
    }
  } catch (error) {}

  return {
    props: {}
  };
}
