import { Flex, Title } from '@tremor/react';
import { Device } from '../lib/types';
import { Product } from '../pages/api/verify-stake';
import CopyAddress from './CopyAddress';
import ListItem from './ListItem';

export default function OnboardDeviceList({
  devices,
  products,
  handleDelete,
  handleChange
}: {
  devices: Device[];
  products: Product[];
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

  const findProduct = (minerKey: string) => {
    const key = minerKey.split('-')[0];
    console.log(key);

    const specificProduct = products.find((product) => {
      return product.key === key;
    });

    return specificProduct;
  };

  return (
    <Flex flexDirection="col" className="w-full px-2 sm:px-20 mt-5">
      {devices.length > 0 ? (
        devices.map((device) => {
          const product = findProduct(device.miner_key);
          return (
            <ListItem
              device={device}
              product={product}
              handleDelete={handleDelete}
              handleChange={handleChange}
            />
          );
        })
      ) : (
        <Title className="text-gray-700">No devices onboarded</Title>
      )}
    </Flex>
  );
}
