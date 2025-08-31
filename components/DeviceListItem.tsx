import { Button, Flex, Title } from '@tremor/react';
import { Device, Product } from '../lib/types';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import EditIcon from './EditIcon';
import { useEffect, useState } from 'react';
import { isProductStakeAvailable } from '../pages/devices';
import { useRouter } from 'next/router';
import {
  computeDeviceStatus,
  isNodeProduct,
  isNodeStaked,
  isRegistartionStaked,
  isRegistrationNeeded
} from '../lib/utils';
import { AnnotationIcon, XCircleIcon } from '@heroicons/react/outline';
import { RiAlertLine } from '@remixicon/react';
import AlertWithTooltip from './AlertIcon';
// import WithdrawIcon from './WithdrawIcon';
import StakingIcon from './StakeIcon';
import SettingIcon from './SettingIcon';
import { useSession } from 'next-auth/react';
import Tooltip from './Tooltip';
import { useRewardSummary } from '../lib/hooks/useRewardSummary';

export default function DeviceListItem({
  initialDevice,
  product,
  stakeable,
  handleDeleteButton,
  handleStaking,
  handleChange,
  handleSetting,
  handleBoostButton,
  handleClaimButton,
  handleWithdrawStake,
  handleWithdrawAllButton,
  initialStatus
  // handleAlgoWithdrawButton,
}: {
  initialDevice: Device;
  product: Product;
  stakeable: boolean;
  handleDeleteButton: (device: Device) => void;
  handleStaking: (miner_key: string) => Promise<void>;
  handleChange: (miner_key: string) => Promise<void>;
  handleSetting: (miner_key: string) => Promise<void>;
  handleBoostButton: (device: Device) => Promise<void>;
  handleClaimButton: (device: Device) => void;
  handleWithdrawStake: (device: Device) => void;
  handleWithdrawAllButton: (device: Device) => void;
  initialStatus?: { [key: string]: string } | undefined;
  // handleAlgoWithdrawButton: (device: Device) => void;
}) {
  const [pendingAmount, setPendingAmount] = useState(0);
  const [claimableAmount, setClaimableAmount] = useState(0);
  const [alertShow, setAlertShow] = useState(!!initialStatus);
  const [deviceStatus, setDeviceStatus] = useState<{ [key: string]: string }>(
    (initialStatus as any) || {}
  );
  const [device, setDevice] = useState<Device>(initialDevice);
  const { data: session } = useSession();

  const isDeviceStatusOkay = (device: Device) => {
    return device.verified && device.verified === true && alertShow === false;
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

  const { data: rewardSummary } = useRewardSummary(device?.miner_key);

  const fetchDeviceInfo = async (minerKey: string) => {
    try {
      const response = await fetch(`/api/devices/${minerKey}`, {
        method: 'POST',
        headers: { 'Content-type': 'application/json' },
        body: JSON.stringify({ address: session?.user.address })
      });
      if (response.ok) {
        const data = await response.json();
        setDevice(data.device as Device);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const checkDeviceStatus = (device: Device) => {
    const status = computeDeviceStatus(device, product);

    if (status === undefined) {
      setAlertShow(false);
      setDeviceStatus({});
      return;
    }

    setDeviceStatus(status);
    setAlertShow(true);
  };

  useEffect(() => {
    console.log('Device Fetch: ' + initialDevice.miner_key);
    fetchDeviceInfo(initialDevice.miner_key);
  }, [initialDevice, product]);

  useEffect(() => {
    if (rewardSummary) {
      setPendingAmount(rewardSummary.pending || 0);
      setClaimableAmount(rewardSummary.claimable || 0);
    }
    checkDeviceStatus(device);
  }, [device, rewardSummary]);

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
          className={`relative w-full border-2 m-1 rounded-lg p-4 text-white shadow-lg ${stakeable === false && !device.verified ? ` border-gray-500` : isDeviceStatusOkay(device) ? ` border-green-500` : `border-red-500`}`}
        >
          <div className="w-full flex flex-row justify-between">
            <div className="flex gap-2">
              <Title className="text-white font-bold text-xl sm:text-2xl mb-2">
                {`${device.nickname ? device.nickname : device.name} ${device.byod ? '(BYOD)' : ''}`}
              </Title>
              {alertShow && (
                <div className="">
                  <AlertWithTooltip deviceStatus={deviceStatus} />
                </div>
              )}
            </div>
            <Flex flexDirection="row" className="gap-3 sm:gap-5 w-auto">
              <div onClick={() => handleSetting(device.miner_key)}>
                <Tooltip children={<SettingIcon />} text="Setting" />
              </div>
              {device && product && isNodeProduct(product) && (
                <div onClick={() => handleStaking(device.miner_key)}>
                  <Tooltip children={<StakingIcon />} text="Staking" />
                </div>
              )}
              <div onClick={() => handleChange(device.miner_key)}>
                <Tooltip children={<EditIcon />} text="Edit" />
              </div>
              <div onClick={() => handleDeleteButton(device)}>
                <Tooltip children={<DeleteIcon />} text="Unregister" />
              </div>
            </Flex>
          </div>
          <hr className="border-gray-800 mt-2"></hr>
          <Flex flexDirection="row" className="mt-4">
            {device.address && device.address.length > 0 ? (
              <>
                <p className="hidden md:block text-white">
                  <strong className="text-white">Address: </strong>
                  {device.address}
                </p>
                <p className="block md:hidden text-white">
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
          <p className="text-white">
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
          {/* PoC Wallet removed from UI */}
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
                  {isStaked() ? 'V-Withdraw' : 'V-Stake'}
                </Button>
              )}
              <Button
                className={`w-full sm:w-auto bg-transparent ${!isProductStakeAvailable(product) ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500' : isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                disabled={claimableAmount <= 0}
                onClick={() => handleClaimButton(device)}
              >
                Claim Reward
              </Button>
              <Button
                className={`w-full sm:w-auto bg-transparent ${!isProductStakeAvailable(product) ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500' : isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                disabled={pendingAmount <= 0}
                onClick={() => handleBoostButton(device)}
              >
                Instant Claim (30% Fee)
              </Button>
              <Button
                className={`w-full sm:w-auto bg-transparent ${!isProductStakeAvailable(product) ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500' : isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                onClick={() => viewHistory()}
              >
                Reward History
              </Button>
              {((device &&
                product &&
                isNodeProduct(product) &&
                isRegistartionStaked(device)) ||
                isNodeStaked(device)) && (
                <Button
                  className={`w-full sm:w-auto bg-transparent ${!isProductStakeAvailable(product) ? 'border-gray-500 hover:bg-gray-500 hover:border-gray-500' : isStaked() ? 'border-green-500 hover:bg-green-500 hover:border-green-500' : 'border-red-500 hover:bg-red-500 hover:border-red-500'}`}
                  onClick={() => handleWithdrawAllButton(device)}
                >
                  Unstake
                </Button>
              )}
            </>
          </Flex>
        </div>
      }
    </>
  );
}
