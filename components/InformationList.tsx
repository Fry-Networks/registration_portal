import { Flex, Title } from '@tremor/react';
import { Device } from '../lib/types';
import CopyAddress from './CopyAddress';
import ListItem from './ListItem';

export default function InformationList({
  devices,
  handleDelete
}: {
  devices: Device[];
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
    <Flex flexDirection="col" className="w-full px-2 sm:px-20 mt-10">
      {devices.length > 0 ? (
        devices.map((device) => {
          return (
            <ListItem device={device} type={0} handleDelete={handleDelete} />
          );
        })
      ) : (
        <Title className="text-gray-700">No devices onboarded</Title>
      )}
    </Flex>
  );
}
