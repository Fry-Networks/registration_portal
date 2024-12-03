import { Button, Flex, Title } from '@tremor/react';
import { Device, Reward } from '../lib/types';
import { Product } from '../pages/api/stake/verify-stake';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import EditIcon from './EditIcon';
import { useEffect, useState } from 'react';
import { isProductStakeAvailable } from '../pages/devices';
import { useRouter } from 'next/router';

export default function RewardListItem({ reward }: { reward: Reward }) {
  return (
    <>
      {
        <div
          className={`w-full border-2 m-1 rounded-lg p-4 text-gray-400 shadow-lg ${reward.status === 'pending' ? 'border-red-500' : reward.status === 'claimable' ? 'border-green-500' : 'border-gray-500'}`}
        >
          <div className="w-full flex flex-row justify-between">
            <Title className="text-white font-bold text-2xl mb-2">
              {reward.miner_key}
            </Title>
          </div>
          <p>
            <strong>Reward Date: </strong>
            {new Date(reward.createdAt).toDateString()}
          </p>
          <p>
            <strong>Reward Amount: </strong> {reward.amount}
          </p>
        </div>
      }
    </>
  );
}
