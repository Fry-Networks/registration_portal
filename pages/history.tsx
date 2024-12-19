import { Button, Flex, Title } from '@tremor/react';
import Image from 'next/image';
import bgImg from '../assets/background.png';
import { getSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { Reward } from '../lib/types';
import RewardListItem from '../components/RewardListItem';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useModal } from '../app/modalcontext';
import ClaimModal from '../components/modals/Claim';
import BoostModal from '../components/modals/Boost';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export default function History({
  initialRewards
}: {
  initialRewards: Reward[];
}) {
  const [rewards, setRewards] = useState<Reward[]>(initialRewards);
  const [page, setPage] = useState(1); // Current page
  const [totalPages, setTotalPages] = useState(0); // Total pages
  const [selReward, setSelReward] = useState<Reward | undefined>(undefined);
  const { openModal } = useModal();
  const router = useRouter();

  const pageSize = 20;

  const { miner_key } = router.query;

  const fetchData = async () => {
    const response = await fetch('api/rewards/get-rewards-page', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        miner_key: miner_key,
        page: page
      })
    });

    if (response.ok) {
      const result = await response.json();
      setRewards(result.items);
      setTotalPages(result.totalPages);
    }
  };

  const handleClaimButton = (reward: Reward) => {
    console.log('Claim Button');
    setSelReward(reward);
    openModal('claim');
  };

  const handleClaim = async (ret: boolean, message: string): Promise<void> => {
    console.log('Claim Action');
    fetchData();
  };

  const handleBoostButton = (reward: Reward) => {
    console.log('Boost Button');
    setSelReward(reward);
    openModal('boost');
  };

  const handleBoost = async (ret: boolean, message: string): Promise<void> => {
    console.log('Boost Action');
    fetchData();
  };

  useEffect(() => {
    fetchData();
  }, [page]);

  const handleNext = () => {
    if (page < totalPages) setPage((prev) => prev + 1);
  };

  const handlePrev = () => {
    if (page > 1) setPage((prev) => prev - 1);
  };

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
          <Title className="text-white text-4xl sm:text-5xl">
            Reward History
          </Title>
          <p className="text-lg text-center text-gray-300">
            You can explore the rewards history and manage each reward for
            miners on here.
          </p>
        </Flex>
      </div>
      <div className="px-2 sm:px-20">
        <Link href="/devices">
          <Button className="mt-6 min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600">
            Back
          </Button>
        </Link>
      </div>
      <div className="mt-6 px-2 sm:px-20">
        <Flex
          className="w-full h-[700px] overflow-y-auto overflow-x-hidden"
          flexDirection="col"
        >
          {rewards &&
            rewards.map((reward) => {
              return (
                <RewardListItem
                  reward={reward}
                  handleClaimButton={handleClaimButton}
                  handleBoostButton={handleBoostButton}
                />
              );
            })}
        </Flex>
      </div>
      <Flex className="mt-4 gap-3" justifyContent="center">
        <Button
          onClick={handlePrev}
          disabled={page === 1}
          className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
        >
          Previous
        </Button>
        <span>
          Page {page} of {totalPages}
        </span>
        <Button
          onClick={handleNext}
          disabled={page === totalPages}
          className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
        >
          Next
        </Button>
      </Flex>

      {selReward && (
        <>
          <ClaimModal
            modalName="claim"
            miner_key={selReward.miner_key}
            no={selReward.no}
            handleClaim={handleClaim}
          />
          <BoostModal
            modalName="boost"
            miner_key={selReward.miner_key}
            no={selReward.no}
            handleBoost={handleBoost}
          />
        </>
      )}
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

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const rewards = await db
      .collection(testMode ? 'test-rewards' : 'rewards')
      .find({ miner_key: miner_key })
      .sort({ _id: -1 })
      .limit(20)
      .toArray();

    if (!rewards) {
      return {
        props: {
          initialRewards: []
        }
      };
    } else {
      return {
        props: {
          initialRewards: JSON.parse(JSON.stringify(rewards))
        }
      };
    }
  } catch (error) {}

  return {
    props: {}
  };
}
