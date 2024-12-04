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
import { Device } from '../lib/types';
import { Product } from './api/stake/verify-stake';
import CopyAddress from '../components/CopyAddress';
import bgImg from '../assets/background.png';
import Image from 'next/image';
import Link from 'next/link';
import MessageUpdate from '../components/MessageUpdate';
import { useModal } from '../app/modalcontext';
import AddDeviceModal from '../components/modals/AddDevice';
import StakeWithdrawModal from '../components/modals/Stake';
import DeviceListItem from '../components/DeviceListItem';
import StakeModal from '../components/modals/Stake';
import WithdrawModal from '../components/modals/Withdraw';
import BoostModal from '../components/modals/Boost';
import ClaimModal from '../components/modals/Claim';
import DeleteModal from '../components/modals/Delete';

export function isProductStakeAvailable(product: Product) {
  let result = false;
  if (product.reward.tokens && product.reward.tokens.stake !== 'none') {
    result = true;
  }

  console.log(result);
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

  const [updateSuccess, setUpdateSuccess] = useState({
    status: 'success',
    message: ''
  });

  const [devices, setDevices] = useState<Device[]>(initialDevices);
  const [selectedDevice, setSelectedDevice] = useState<Device>(
    initialDevices[0]
  );

  const handleAdd = () => {
    console.log('Add devices');
    openModal('addDevice');
  };

  const handleRegister = async (minerKey: string): Promise<void> => {
    console.log(minerKey);

    try {
      const response = await fetch(`/api/devices/${minerKey}`);
      if (!response.ok) {
        setUpdateSuccess({ status: 'error', message: 'Device not found' });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);

        return;
      }

      const product = findProductByMinerKey(minerKey, products);
      if (!product) {
        setUpdateSuccess({
          status: 'error',
          message: 'Product for miner is not found'
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);
        return;
      }

      console.log(product);

      if (
        product.reward.stake &&
        product.reward.stake.register > 0 &&
        product.reward.tokens?.register &&
        product.reward.tokens.register !== 'none'
      ) {
        router.push({ pathname: '/pay-register', query: { minerKey } });
      } else {
        router.push({ pathname: '/register', query: { minerKey } });
      }
    } catch (error) {
      setUpdateSuccess({
        status: 'error',
        message:
          'There is an error occured for registering. Please contact us before you try again.'
      });
      setTimeout(() => {
        setUpdateSuccess({ status: 'error', message: '' });
      }, 5_000);
      return;
    }
  };

  const handleDeleteButton = (device: Device) => {
    setSelectedDevice(device);
    openModal('delete');
  };

  const handleDelete = async (miner_key: string): Promise<void> => {
    // Send a request to delete the device from the backend
    setUpdateSuccess({
      status: 'success',
      message: 'Un-Registered devices succesfully'
    });
    setTimeout(() => {
      setUpdateSuccess({ status: 'success', message: '' });
    }, 5_000);

    setDevices((prevDevices) =>
      prevDevices.filter((device) => device.miner_key !== miner_key)
    );
  };

  const handleChange = async (miner_key: string): Promise<void> => {
    // Redirect to an edit page where the device details can be modified
    try {
      const response = await fetch(`/api/devices/${miner_key}`);
      if (!response.ok) {
        setUpdateSuccess({ status: 'error', message: 'Device not found.' });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);
      }

      router.push({
        pathname: '/register',
        query: { minerKey: miner_key, clickable: 'true' }
      });
    } catch (error) {
      setUpdateSuccess({
        status: 'error',
        message: 'Failed to fetch device information.'
      });
      setTimeout(() => {
        setUpdateSuccess({ status: 'error', message: '' });
      }, 5_000);
    }
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

    setUpdateSuccess({
      status: 'success',
      message: `Miner ${selectedDevice.miner_key} boosted successfully`
    });

    setTimeout(() => {
      setUpdateSuccess({ status: 'success', message: '' });
    }, 5_000);

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

    setUpdateSuccess({
      status: 'success',
      message: message
    });

    setTimeout(() => {
      setUpdateSuccess({ status: 'success', message: '' });
    }, 5_000);

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

    setUpdateSuccess({
      status: 'success',
      message: `Miner ${device.miner_key} verified successfully`
    });

    setTimeout(() => {
      setUpdateSuccess({ status: 'success', message: '' });
    }, 5_000);

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

    setUpdateSuccess({
      status: 'success',
      message: `Miner ${device.miner_key} unverified successfully`
    });

    setTimeout(() => {
      setUpdateSuccess({ status: 'success', message: '' });
    }, 5_000);

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
          <Title className="text-white text-5xl">
            Onboard your miners to Fry networks
          </Title>
          <p className="text-lg">
            You can register your miners to onboard on Fry networks and can
            verify and manage miner information here.
          </p>
        </Flex>
      </div>
      <Flex
        flexDirection="row"
        justifyContent="evenly"
        className="flex-wrap gap-6 px-2 sm:px-20 mt-10"
      >
        <div className="rounded-xl p-5 shadow-md shadow-gray-600 min-w-[200px] w-full sm:w-auto ">
          <Title className="text-white">Registered Miners</Title>
          <p>{devices.length}</p>
        </div>
        <div className="rounded-xl p-5 shadow-md shadow-red-600 min-w-[200px]  w-full sm:w-auto ">
          <Title className="text-white">Unverified Miners</Title>
          <p>{devices.filter((device) => !device.verified).length}</p>
        </div>
        <div className="rounded-xl p-5 shadow-md shadow-green-600 min-w-[200px] w-full sm:w-auto ">
          <Title className="text-white">Verified Miners</Title>
          <p>{devices.filter((device) => device.verified).length}</p>
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
      <div className="px-2 sm:px-20">
        <MessageUpdate updateSuccess={updateSuccess} />
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
                handleDeleteButton={handleDeleteButton}
                handleChange={handleChange}
                handleBoostButton={handleBoostButton}
                handleClaimButton={handleClaimButton}
                handleWithdrawStake={handleWithdrawStake}
              />
            );
          })
        ) : (
          <Title className="text-gray-700">No devices onboarded</Title>
        )}
      </Flex>
      <AddDeviceModal modalName="addDevice" handleRegister={handleRegister} />
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
    </div>
  );
};

export async function getServerSideProps(context: any) {
  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';
  const session = await getSession(context);

  console.log(testMode);

  console.log(session);

  if (!session || !session.user.address) {
    return {
      props: {}
    };
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    console.log(session.user.address);

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
