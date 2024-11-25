import { Flex, Title } from '@tremor/react';
import { Device } from '../lib/types';
import CopyAddress from './CopyAddress';
import DeleteIcon from './DeleteIcon';
import EditIcon from './EditIcon';

export default function ListItem({
  device,
  type,
  handleDelete,
  handleChange
}: {
  device: Device;
  type: number;
  handleDelete: (miner_key: string) => Promise<void>;
  handleChange: (miner_key: string) => Promise<void>;
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
              <div onClick={() => handleChange(device.miner_key)}>
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
      }
    </>
  );
}
