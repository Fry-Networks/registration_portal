import { Button, Flex, Title } from '@tremor/react';
import { Device, Reward } from '../lib/types';
import { Product } from '../pages/api/stake/verify-stake';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import EditIcon from './EditIcon';
import { useEffect, useState } from 'react';
import { isProductStakeAvailable } from '../pages/devices';
import { useRouter } from 'next/router';

export default function RewardListItem({
  reward,
  handleClaimButton,
  handleBoostButton
}: {
  reward: Reward;
  handleClaimButton: (reward: Reward) => void;
  handleBoostButton: (reward: Reward) => void;
}) {
  return (
    <>
      {
        <div
          className={`w-full border-2 m-1 rounded-lg p-4 text-gray-400 shadow-lg ${reward.status === 'pending' ? 'border-red-500' : reward.status === 'claimable' ? 'border-green-500' : 'border-gray-500'}`}
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
            {reward.amount}
          </p>
          {reward.status === 'claimed' && (
            <p>
              <strong className="text-white">Claimed TxId: </strong>
              {reward.txId}
            </p>
          )}
          {reward.status !== 'claimed' && (
            <Flex justifyContent="start" className="gap-3 mt-3 w-full sm:auto">
              <>
                <Button
                  className={`bg-transparent ${reward.status === 'pending' ? 'border-red-500' : reward.status === 'claimable' ? 'border-green-500' : 'border-gray-500'}`}
                  disabled={
                    reward.status === 'pending' || reward.status === 'claimed'
                  }
                  onClick={() => handleClaimButton(reward)}
                >
                  Claim
                </Button>
                <Button
                  className={`bg-transparent ${reward.status === 'pending' ? 'border-red-500' : reward.status === 'claimable' ? 'border-green-500' : 'border-gray-500'}`}
                  disabled={reward.status !== 'pending'}
                  onClick={() => handleBoostButton(reward)}
                >
                  Boost
                </Button>
              </>
            </Flex>
          )}
        </div>
      }
    </>
  );
}
