import { Button, Flex, Title } from '@tremor/react';
import { Device, Reward } from '../lib/types';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import EditIcon from './EditIcon';
import { useEffect, useState } from 'react';
import { isProductStakeAvailable } from '../pages/devices';
import { useRouter } from 'next/router';
import ProgressDateBar from './ProgressDateBar';
import { getTransactionTime, getAssetName } from '../lib/utils';

export default function RewardListItem({
  reward,
  handleClaimButton,
  handleBoostButton
}: {
  reward: Reward;
  handleClaimButton: (reward: Reward) => void;
  handleBoostButton: (reward: Reward) => void;
}) {

  const [claimedTime, setClaimedTime] = useState<string | undefined>();

  useEffect(() => {
    if (reward.claimedAt) {
      setClaimedTime(new Date(reward.claimedAt).toDateString());
      return;
    }
    const fetchData = async () => {
      if (!reward.txId) {
        setClaimedTime(undefined);
        return;
      }
      const t = await getTransactionTime(reward.txId, { retries: 1, delayMs: 500 });
      setClaimedTime(t.toDateString());
    };
    fetchData();
  }, [reward.status, reward.txId, reward.claimedAt]);

  return (
    <>
      {
        <div
          className={`w-full border-2 m-1 rounded-lg p-4 text-gray-300 bg-black/40 backdrop-blur-sm shadow-lg ${reward.status === 'pending' ? 'border-red-500/70' : reward.status === 'claimable' ? 'border-green-500/70' : 'border-gray-700/70'}`}
        >
          <div className="w-full flex flex-row justify-between">
            <Title className="text-white font-bold text-2xl mb-2 hidden sm:block">
              {reward.miner_key}
            </Title>
            <strong className="text-white block sm:hidden">
              {reward.miner_key}
            </strong>
          </div>
          <hr className="border-gray-800 mt-2"></hr>
          <p className="mt-4">
            <strong className="text-white">Reward Date: </strong>
            {new Date(reward.createdAt).toDateString()}
          </p>
          <p>
            <strong className="text-white">Reward Amount: </strong>{' '}
            {reward.amount} {getAssetName(reward.asset_id)}
          </p>
          {reward.status === 'claimed' && (
            <>
              <p>
                <strong className="text-white">Claimed TxId: </strong>
                {reward.txId ? (
                  <a
                    href={`https://explorer.perawallet.app/tx/${reward.txId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:underline break-all"
                  >
                    {reward.txId}
                  </a>
                ) : (
                  '-'
                )}
              </p>
              <p>
                <strong className="text-white">Claimed Time: </strong>
                {claimedTime || '-'}
              </p>
            </>
          )}
          {reward.status !== 'claimed' && (
            <>
              <ProgressDateBar
                specificDate={reward.createdAt}
                boosted={reward.status === 'claimable'}
              />
              <Flex
                justifyContent="start"
                className="gap-3 mt-3 w-full sm:auto"
              >
                <>
                  <Button
                    className={`bg-transparent transition-colors duration-150 ${reward.status === 'pending' ? 'border-red-500 text-red-300 hover:bg-red-600/10' : reward.status === 'claimable' ? 'border-green-500 text-green-300 hover:bg-green-600/10' : 'border-gray-500 text-gray-500 cursor-not-allowed'}`}
                    disabled={
                      reward.status === 'pending' || reward.status === 'claimed'
                    }
                    onClick={() => handleClaimButton(reward)}
                  >
                    Claim Reward
                  </Button>
                  <Button
                    className={`bg-transparent transition-colors duration-150 ${reward.status === 'pending' ? 'border-red-600 text-red-300 hover:bg-red-600/10 hover:text-red-200' : reward.status === 'claimable' ? 'border-green-500 text-green-300 hover:bg-green-600/10 cursor-not-allowed' : 'border-gray-500 text-gray-500 cursor-not-allowed'}`}
                    disabled={reward.status !== 'pending'}
                    onClick={() => handleBoostButton(reward)}
                  >
                    Instant Claim (30% Fee)
                  </Button>
                </>
              </Flex>
            </>
          )}
        </div>
      }
    </>
  );
}
