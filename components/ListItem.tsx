import { Flex, Title } from '@tremor/react';
import { Device } from '../lib/types';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import EditIcon from './EditIcon';

export default function ListItem({
  device,
  type,
  handleDelete
}: {
  device: Device;
  type: number;
  handleDelete: (miner_key: string) => Promise<void>;
}) {
  const isDeviceStatusOkay = (device: Device) => {
    return (
      device.verified &&
      device.verified === true &&
      device.position &&
      device.reward_wallet
    );
  };

  return (
    <>
      {
        <div
          className={`w-full border-2 rounded-lg p-4 text-gray-400 shadow-lg ${isDeviceStatusOkay(device) ? ` border-green-500` : `border-red-500`}`}
        >
          <div className="w-full flex flex-row justify-between">
            <Title className="text-white font-bold text-2xl mb-2">
              {device.name}
            </Title>
            <Flex flexDirection="row" className="gap-3 w-auto">
              <div>
                <EditIcon />
              </div>
              <div onClick={() => handleDelete(device.miner_key)}>
                <DeleteIcon />
              </div>
            </Flex>
          </div>
          <Flex flexDirection="row">
            {device.address && device.address.length > 0 ? (
              <>
                <p className="hidden sm:block">
                  <strong className="text-white">Address: </strong>
                  {device.address}
                </p>
                <p className="block sm:hidden">
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
        </div>
        /* {type === 0 ? (
        <div
          className={`w-full border-2 rounded-lg p-4 text-gray-400 shadow-lg ${isDeviceStatusOkay(device) ? ` border-green-500` : `border-red-500`}`}
        >
          <Title className="text-white font-bold text-2xl mb-2">
            {device.name}
          </Title>
          <Flex flexDirection="row">
            {device.address && device.address.length > 0 ? (
              <>
                <p className="hidden sm:block">
                  <strong className="text-white">Address: </strong>
                  {device.address}
                </p>
                <p className="block sm:hidden">
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
            <strong className="text-white">Email: </strong>
            {device.email && device.email.length > 0 ? device.email : `None`}
          </p>
          <p>
            <strong className="text-white">Position: </strong>
            {device.position
              ? `Latitude-(${device.position.lat})  Longitude-(${device.position.lng})`
              : `None`}
          </p>
          <p>
            <strong className="text-white">Verification: </strong>
            {device.verified && device.verified === true
              ? 'Verified'
              : 'Not verified'}
          </p>
          <Flex flexDirection="row">
            {device.reward_wallet && device.reward_wallet.length > 0 ? (
              <>
                <p className="hidden sm:block">
                  <strong className="text-white">Reward Wallet: </strong>
                  {device.reward_wallet}
                </p>
                <p className="block sm:hidden">
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
              <p>Address: None</p>
            )}
          </Flex>
        </div>
      ) : (
        <div
          className={`w-full border-2 rounded-lg p-4 text-gray-400 ${device.verified && device.verified === true ? ` border-green-500` : `border-red-500`}`}
        >
          <Title className="text-white font-bold text-2xl mb-2">
            {device.name}
          </Title>
          <Flex flexDirection="row">
            {device.address && device.address.length > 0 ? (
              <>
                <p className="hidden sm:block">
                  <strong className="text-white">Address: </strong>
                  {device.address}
                </p>
                <p className="block sm:hidden">
                  <strong className="text-white">Address: </strong>
                  {device.address.slice(0, 6)}...$
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
            <strong className="text-white">Staked Period: </strong>
            {device.staked && device.staked.type.length > 0
              ? device.staked.type === 'one'
                ? '24 hours '
                : '6 months'
              : 'Unknown'}
          </p>
          <p>
            <strong className="text-white">Staked Amount: </strong>
            {device.staked && device.staked.amount > 0
              ? device.staked.amount
              : 0}
          </p>
          <p>
            <strong className="text-white">Staked Time: </strong>
            {device.staked && device.staked.time
              ? `${new Date(device.staked.time)}`
              : 'Unknown'}
          </p>
          <p>
            <strong className="text-white">Last reward Time: </strong>
            {device.staked && device.staked.rewarded_time
              ? `${new Date(device.staked.rewarded_time)}`
              : 'Unknown'}
          </p>
        </div>
      )} */
      }
    </>
  );
}
