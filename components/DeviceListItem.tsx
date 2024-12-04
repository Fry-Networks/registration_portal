import { Button, Flex, Title } from '@tremor/react';
import { Device, Reward } from '../lib/types';
import { Product } from '../pages/api/stake/verify-stake';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import EditIcon from './EditIcon';
import { useEffect, useState } from 'react';
import { isProductStakeAvailable } from '../pages/devices';
import { useRouter } from 'next/router';

export default function DeviceListItem({
  initialDevice,
  product,
  stakeable,
  handleDeleteButton,
  handleChange,
  handleBoostButton,
  handleClaimButton,
  handleWithdrawStake
}: {
  initialDevice: Device;
  product: Product;
  stakeable: boolean;
  handleDeleteButton: (device: Device) => void;
  handleChange: (miner_key: string) => Promise<void>;
  handleBoostButton: (device: Device) => Promise<void>;
  handleClaimButton: (device: Device) => void;
  handleWithdrawStake: (device: Device) => void;
}) {
  const [pendingAmount, setPendingAmount] = useState(0);
  const [claimableAmount, setClaimableAmount] = useState(0);

  const [device, setDevice] = useState<Device>(initialDevice);
  const isDeviceStatusOkay = (device: Device) => {
    return device.verified && device.verified === true;
  };

  const router = useRouter();
  const isStaked = () => {
    if (!device) {
      return false;
    }

    if (!device.verified) {
      return false;
    }

    return true;
  };

  const fetchRewardAmounts = async (device: Device, product: Product) => {
    try {
      const pendingResponse = await fetch('api/rewards/get-reward-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          miner_key: device.miner_key,
          status: 'pending'
        })
      });

      if (pendingResponse.ok) {
        const result = await pendingResponse.json();
        const pendingRecords = result.records as Reward[];
        const pendingTotalAmount = pendingRecords.reduce(
          (sum, record) =>
            Math.round(
              (sum + (typeof record.amount === 'number' ? record.amount : 0)) *
                100
            ) / 100,
          0
        );

        setPendingAmount(pendingTotalAmount);
      }

      console.log(`${device.miner_key} get pending success`);

      const claimableResponse = await fetch('api/rewards/get-reward-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          miner_key: device.miner_key,
          status: 'claimable'
        })
      });

      if (claimableResponse.ok) {
        const result = await claimableResponse.json();
        const claimableRecords = result.records as Reward[];
        const claimableTotalAmount = claimableRecords.reduce(
          (sum, record) =>
            Math.round(
              (sum + (typeof record.amount === 'number' ? record.amount : 0)) *
                100
            ) / 100,
          0
        );

        setClaimableAmount(claimableTotalAmount);
      }
    } catch (error) {}
  };

  const fetchDeviceInfo = async (minerKey: string) => {
    console.log(minerKey);
    try {
      const response = await fetch(`/api/devices/${minerKey}`);
      if (response.ok) {
        const data = await response.json();
        setDevice(data.device as Device);
      }
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchDeviceInfo(initialDevice.miner_key);
  }, [initialDevice, product]);

  useEffect(() => {
    fetchRewardAmounts(device, product);
  }, [device]);

  const viewHistory = async (): Promise<void> => {
    router.push({
      pathname: '/history',
      query: { miner_key: device.miner_key }
    });
  };

  return (
    <>
      {
        <div
          className={`w-full border-2 m-1 rounded-lg p-4 text-gray-400 shadow-lg ${stakeable === false && !device.verified ? ` border-gray-500` : isDeviceStatusOkay(device) ? ` border-green-500` : `border-red-500`}`}
        >
          <div className="w-full flex flex-row justify-between">
            <Title className="text-white font-bold text-2xl mb-2">
              {device.name}
            </Title>
            <Flex flexDirection="row" className="gap-5 w-auto">
              <div onClick={() => handleChange(device.miner_key)}>
                <EditIcon />
              </div>
              <div onClick={() => handleDeleteButton(device)}>
                <DeleteIcon />
              </div>
            </Flex>
          </div>
          <hr className="border-gray-800 mt-2"></hr>
          <Flex flexDirection="row" className="mt-4">
            {device.address && device.address.length > 0 ? (
              <>
                <p className="hidden md:block">
                  <strong className="text-white">Address: </strong>
                  {device.address}
                </p>
                <p className="block md:hidden">
                  <strong className="text-white">Address: </strong>
                  {device.address.slice(0, 6)}...
                  {device.address.slice(
                    device.address.length - 6,
                    device.address.length
                  )}
                </p>
                <CopyAddress address={device.address} />
              </>
            ) : (
              <p>Address: None</p>
            )}
          </Flex>
          <p>
            <strong className="text-white">Miner Key: </strong>
            {device.miner_key && device.miner_key.length > 0
              ? device.miner_key
              : 'None'}
          </p>
          <p>
            <strong className="text-white">Position: </strong>
            {device.position
              ? `Latitude (${device.position.lat}), Longitude (${device.position.lng})`
              : 'None'}
          </p>
          <Flex flexDirection="row">
            {device.reward_wallet && device.reward_wallet.length > 0 ? (
              <>
                <p className="hidden md:block">
                  <strong className="text-white">Reward Wallet: </strong>
                  {device.reward_wallet}
                </p>
                <p className="block md:hidden">
                  <strong className="text-white">Reward Wallet: </strong>
                  {device.reward_wallet.slice(0, 6)}...
                  {device.reward_wallet.slice(
                    device.reward_wallet.length - 6,
                    device.reward_wallet.length
                  )}
                </p>
                <CopyAddress address={device.reward_wallet} />
              </>
            ) : (
              <p>
                <strong className="text-white">Reward Wallet: </strong> None
              </p>
            )}
          </Flex>
          <p>
            <strong className="text-white">Pending Reward Amount: </strong>
            {pendingAmount}
          </p>
          <p>
            <strong className="text-white">Claimable Reward Amount: </strong>
            {claimableAmount}
          </p>
          <Flex
            justifyContent="start"
            className="gap-3 mt-3 flex-wrap sm:flex-nowrap"
          >
            <>
              {(isProductStakeAvailable(product) || device.verified) && (
                <Button
                  className={`w-full sm:w-auto bg-transparent ${isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                  onClick={() => {
                    handleWithdrawStake(device);
                  }}
                >
                  {isStaked() ? 'Withdraw' : 'Stake'}
                </Button>
              )}
              <Button
                className={`w-full sm:w-auto bg-transparent ${!isProductStakeAvailable(product) ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500' : isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                disabled={claimableAmount <= 0}
                onClick={() => handleClaimButton(device)}
              >
                Claim
              </Button>
              <Button
                className={`w-full sm:w-auto bg-transparent ${!isProductStakeAvailable(product) ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500' : isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                disabled={pendingAmount <= 0}
                onClick={() => handleBoostButton(device)}
              >
                Boost
              </Button>
              <Button
                className={`w-full sm:w-auto bg-transparent ${!isProductStakeAvailable(product) ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500' : isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                onClick={() => viewHistory()}
              >
                Reward History
              </Button>
            </>
          </Flex>
        </div>
      }
    </>
  );
}
