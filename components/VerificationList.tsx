import { Flex, Title } from '@tremor/react';
import { Device } from '../lib/types';
import CopyAddress from './CopyAddress';
import ListItem from './ListItem';

export default function VerificationList({
  devices,
  handleDelete
}: {
  devices: Device[];
  handleDelete: (miner_key: string) => Promise<void>;
}) {
  const getStakedDevicesCnt = () => {
    return devices?.filter((device) => device.verified === true).length;
  };

  const getTotalStakedAmount = () => {
    return devices.reduce(
      (sum, device) => sum + (device.staked ? device.staked?.amount : 0),
      0
    );
  };

  return (
    <Flex flexDirection="col" className="w-full px-2 sm:px-40 mt-10">
      {devices.length > 0 ? (
        <>
          <Flex flexDirection="row" justifyContent="between" className="mb-10">
            <p>Staked Devices: {getStakedDevicesCnt()}</p>
            <p>Total Staked Amount: {getTotalStakedAmount()}</p>
          </Flex>
          {devices.map((device) => {
            return (
              <ListItem device={device} type={1} handleDelete={handleDelete} />
            );
          })}
        </>
      ) : (
        <Title className="text-gray-700">No devices onboarded</Title>
      )}
    </Flex>
  );
}
