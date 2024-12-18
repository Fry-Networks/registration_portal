import { useEffect, useState } from 'react';
import {
  UserIcon,
  UserAddIcon,
  UserRemoveIcon
} from '@heroicons/react/outline';
import { useRouter } from 'next/router';
import { Button, Flex, Title } from '@tremor/react';
import { getSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { Device, Product } from '../lib/types';
import CopyAddress from '../components/CopyAddress';
import bgImg from '../assets/background.png';
import Image from 'next/image';
import Link from 'next/link';
import MessageUpdate from '../components/messageUpdate';
import { useModal } from '../app/modalcontext';
import AddDeviceModal from '../components/modals/AddDevice';
import StakeWithdrawModal from '../components/modals/Stake';
import DeviceListItem from '../components/DeviceListItem';
import StakeModal from '../components/modals/Stake';
import WithdrawModal from '../components/modals/Withdraw';
import BoostModal from '../components/modals/Boost';
import ClaimModal from '../components/modals/Claim';
import DeleteModal from '../components/modals/Delete';
import { useToastContext } from '../hooks/ToastContext';
import WithdrawAllModal from '../components/modals/WithdarwAll';
import { isNodeStaked, isRegistartionStaked } from '../lib/utils';

export function isProductStakeAvailable(product: Product) {
  let result = false;
  if (product.reward.tokens && product.reward.tokens.stake !== 'none') {
    result = true;
  }

  return result;
}

export function findProductByMinerKey(miner_key: string, products: Product[]) {
  const miner_type = miner_key.split('-')[0];

  return products.find((product) => product.key === miner_type);
}

const DevicesPage = ({
  initialDevices = [],
  products = []
}: {
  initialDevices: Device[];
  products: Product[];
}) => {
  const router = useRouter();
  const { openModal } = useModal();

  const [devices, setDevices] = useState<Device[]>(initialDevices);
  const [selectedDevice, setSelectedDevice] = useState<Device>(
    initialDevices[0]
  );

  const toast = useToastContext();

  const handleAdd = () => {
    console.log('Add devices');
    openModal('addDevice');
  };

  const handleRegister = async (minerKey: string): Promise<void> => {
    try {
      const response = await fetch(`/api/devices/${minerKey}`);
      if (!response.ok) {
        toast.error({ heading: 'Error', message: 'Device not found' });

        return;
      }

      const result = await response.json();
      if (result.device.is_registered) {
        toast.error({ heading: 'Error', message: 'Already registered' });

        return;
      }

      router.push({ pathname: '/register', query: { minerKey } });
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'There is an error occured for registering. Please contact us before you try again'
      });
      return;
    }
  };

  const handleDeleteButton = (device: Device) => {
    setSelectedDevice(device);

    console.log('Verification: ' + device.verified);
    if (
      isRegistartionStaked(device) ||
      isNodeStaked(device) ||
      device.verified
    ) {
      toast.warning({
        heading: 'Warning',
        message:
          'After withdraw all you staked. You can un-register your device.'
      });
      return;
    }
    openModal('delete');
  };

  const handleDelete = async (miner_key: string): Promise<void> => {
    // Send a request to delete the device from the backend
    setDevices((prevDevices) =>
      prevDevices.filter((device) => device.miner_key !== miner_key)
    );
  };

  const handleWithdrawAll = async (device: Device): Promise<void> => {
    const updatedMiners = devices.map((value) => {
      if (value.miner_key !== device.miner_key) {
        return value;
      } else {
        let returnDevice = { ...value };
        if (returnDevice.registration) {
          returnDevice.registration = undefined;
        }

        if (returnDevice.node) {
          returnDevice.node = undefined;
        }

        return returnDevice;
      }
    }) as Device[];
    setDevices(updatedMiners);
  };

  const handleChange = async (miner_key: string): Promise<void> => {
    // Redirect to an edit page where the device details can be modified
    try {
      const response = await fetch(`/api/devices/${miner_key}`);
      if (!response.ok) {
        toast.error({
          heading: 'Error',
          message: `Device not found.`
        });
      }

      router.push({
        pathname: '/register',
        query: { minerKey: miner_key, clickable: 'true' }
      });
    } catch (error) {
      toast.error({
        heading: 'Error',
        message: `Failed to fetch device information.`
      });
    }
  };

  const handleStaking = async (miner_key: string): Promise<void> => {
    // Redirect to an edit page where the device details can be modified
    router.push({ pathname: '/pay-register', query: { minerKey: miner_key } });
  };

  const handleWithdrawStake = (device: Device): void => {
    console.log(device.verified);
    setSelectedDevice(device);

    if (!device.verified) {
      openModal('stake');
    } else {
      openModal('withdraw');
    }
  };

  const handleWithdrawAllButton = (device: Device): void => {
    setSelectedDevice(device);

    openModal('withdraw_all');
  };

  const handleClaimButton = (device: Device) => {
    setSelectedDevice(device);
    openModal('claim');
  };

  const handleBoostButton = async (device: Device): Promise<void> => {
    setSelectedDevice(device);
    openModal('boost');
  };

  const handleBoost = async (ret: boolean, message: string): Promise<void> => {
    console.log('Boost function');

    const updateDevices = devices.map((element) => {
      if (element.miner_key !== selectedDevice.miner_key) {
        return element;
      } else {
        return {
          ...element
        };
      }
    }) as Device[];

    setDevices(updateDevices);
  };

  const handleClaim = async (ret: boolean, message: string): Promise<void> => {
    console.log('Boost function');

    const updateDevices = devices.map((element) => {
      if (element.miner_key !== selectedDevice.miner_key) {
        return element;
      } else {
        return {
          ...element
        };
      }
    }) as Device[];

    setDevices(updateDevices);
  };

  const handleStakingUpdate = (device: Device): void => {
    console.log('Staked device update');
    const updateDevices = devices.map((element) => {
      if (element.miner_key !== device.miner_key) {
        return element;
      } else {
        return {
          ...element,
          verified: true
        };
      }
    }) as Device[];

    setDevices(updateDevices);
  };

  const handleWithdrawUpdate = (device: Device): void => {
    console.log('Withdraw device update');
    const updateDevices = devices.map((element) => {
      if (element.miner_key !== device.miner_key) {
        return element;
      } else {
        return {
          ...element,
          verified: false
        };
      }
    }) as Device[];

    setDevices(updateDevices);
  };

  return (
    <div className="w-full">
      <div className="relative flex">
        <Image
          src={bgImg}
          className="w-full h-[30vh] object-cover"
          alt="Background Image"
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-6"
        >
          <Title className="text-white text-4xl sm:text-5xl w-full text-center">
            Onboard your miners to Fry Networks
          </Title>
          <p className="text-lg text-center px-2 text-gray-300">
            You can register your miners to onboard on Fry Networks and can
            verify and manage miner information here.
          </p>
        </Flex>
      </div>
      <Flex
        flexDirection="row"
        justifyContent="evenly"
        className="flex-wrap gap-6 px-2 sm:px-20 mt-10"
      >
        <div className="flex flex-col items-center justify-center rounded-xl p-5 shadow-md shadow-gray-600 min-w-[200px] w-full sm:w-auto gap-2">
          <Title className="text-white">Registered Miners</Title>
          <p className='flex text-gray-300 text-lg'>{devices.length}</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl p-5 shadow-md shadow-red-600 min-w-[200px]  w-full sm:w-auto gap-2">
          <Title className="text-white">Unverified Miners</Title>
          <p className='flex text-gray-300 text-lg'>{devices.filter((device) => !device.verified).length}</p>
        </div>
        <div className="flex flex-col items-center justify-center rounded-xl p-5 shadow-md shadow-green-600 min-w-[200px] w-full sm:w-auto gap-2">
          <Title className="text-white">Verified Miners</Title>
          <p className='flex text-gray-300 text-lg'>{devices.filter((device) => device.verified).length}</p>
        </div>
      </Flex>

      <div className="w-full mt-10 px-2 sm:px-20">
        <Flex
          flexDirection="row"
          justifyContent="end"
          className="gap-3 w-full mt-10"
        >
          <Link href="/convert">
            <Button className="min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600">
              BYOD to Miner Key
            </Button>
          </Link>

          <Button
            className="min-w-[150px] bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={handleAdd}
          >
            + Add
          </Button>
        </Flex>
      </div>
      <Flex flexDirection="col" className="w-full px-2 sm:px-20 mt-5">
        {devices.length > 0 ? (
          devices.map((device, index) => {
            const product = findProductByMinerKey(device.miner_key, products);
            return (
              <DeviceListItem
                key={`list item ${index}`}
                initialDevice={device}
                product={product!}
                stakeable={isProductStakeAvailable(product!)}
                handleStaking={handleStaking}
                handleDeleteButton={handleDeleteButton}
                handleChange={handleChange}
                handleBoostButton={handleBoostButton}
                handleClaimButton={handleClaimButton}
                handleWithdrawStake={handleWithdrawStake}
                handleWithdrawAllButton={handleWithdrawAllButton}
              />
            );
          })
        ) : (
          <Title className="text-gray-700">No devices onboarded</Title>
        )}
      </Flex>
      <AddDeviceModal modalName="addDevice" handleRegister={handleRegister} />
      {selectedDevice && (
        <>
          <StakeModal
            modalName={'stake'}
            device={selectedDevice}
            product={findProductByMinerKey(selectedDevice.miner_key, products)!}
            handleStakingUpdate={handleStakingUpdate}
          />
          <WithdrawModal
            modalName={'withdraw'}
            device={selectedDevice}
            product={findProductByMinerKey(selectedDevice.miner_key, products)!}
            handleWithdrawUpdate={handleWithdrawUpdate}
          />
          <BoostModal
            modalName="boost"
            miner_key={selectedDevice.miner_key}
            handleBoost={handleBoost}
          />
          <ClaimModal
            modalName="claim"
            miner_key={selectedDevice.miner_key}
            handleClaim={handleClaim}
          />
          <DeleteModal
            modalName="delete"
            miner_key={selectedDevice.miner_key}
            handleDelete={handleDelete}
          />
          <WithdrawAllModal
            modalName="withdraw_all"
            device={selectedDevice}
            handleWithdrawAll={handleWithdrawAll}
          />
        </>
      )}
    </div>
  );
};

export async function getServerSideProps(context: any) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  const session = await getSession(context);

  console.log(testMode);

  if (!session || !session.user.address) {
    return {
      props: {}
    };
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    // const collection = db.collection('devices');
    // let query = { miner_key: { $regex: "OMAQM", $options: "i" } };

    // let records = await collection
    //   .find(query, {})
    //   .toArray();

    // for (const doc of records) {
    //   if (doc.miner_key) {
    //     const updatedCode = doc.miner_key.replace(/OHAQM/gi, "OMAQM");
    //     await collection.updateOne(
    //       { _id: doc._id }, // Match the document by its unique _id
    //       { $set: { miner_key: updatedCode } } // Update the 'code' field with the new value
    //     );
    //   }
    // }

    const devices = await db
      .collection(testMode ? 'test-devices' : 'devices')
      .find({ address: session.user.address, is_registered: true })
      .toArray();

    const products = await db.collection('products').find({}).toArray();

    console.log(devices);
    if (!devices && !products) {
      return {
        props: {
          devices: [],
          products: []
        }
      };
    } else if (!devices && products) {
      return {
        props: {
          initialDevices: [],
          products: JSON.parse(
            JSON.stringify(
              products.map((product) => {
                return {
                  name: product.name,
                  key: product.key,
                  reward: product.reward
                };
              })
            )
          )
        }
      };
    } else if (devices && !products) {
      return {
        props: {
          initialDevices: JSON.parse(
            JSON.stringify(
              devices.map((device) => {
                return {
                  address: device.address,
                  byod: device.byod,
                  is_registered: device.is_registered,
                  miner_key: device.miner_key,
                  name: device.name,
                  nickname: device.nickname,
                  position: device.position,
                  reward_wallet: device.reward_wallet,
                  staked: device.staked,
                  stake_type: device.stake_type,
                  verified: device.verified,
                  hexId: device.hexId,
                  created_at: device.created_at,
                  email: device.email
                };
              })
            )
          ),
          products: []
        }
      };
    } else {
      return {
        props: {
          initialDevices: JSON.parse(
            JSON.stringify(
              devices.map((device) => {
                return {
                  address: device.address,
                  byod: device.byod,
                  is_registered: device.is_registered,
                  miner_key: device.miner_key,
                  name: device.name,
                  nickname: device.nickname,
                  position: device.position,
                  reward_wallet: device.reward_wallet,
                  staked: device.staked,
                  stake_type: device.stake_type,
                  verified: device.verified,
                  hexId: device.hexId,
                  created_at: device.created_at,
                  email: device.email
                };
              })
            )
          ),
          products: JSON.parse(
            JSON.stringify(
              products.map((product) => {
                return {
                  name: product.name,
                  key: product.key,
                  reward: product.reward
                };
              })
            )
          )
        }
      };
    }
  } catch (e) {
    console.error(e);
    return {
      props: {}
    };
  }
}

export default DevicesPage;
