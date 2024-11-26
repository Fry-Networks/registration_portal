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
import CopyAddress from '../components/CopyAddress';
import OnboardDeviceList from '../components/OnboardDeviceList';
import bgImg from '../assets/background.png';
import Image from 'next/image';
import Link from 'next/link';
import MessageUpdate from '../components/messageUpdate';
import { useModal } from '../app/modalcontext';
import AddDeviceModal from '../components/modals/AddDevice';

const DevicesPage = ({ devices = [] }: { devices: Device[] }) => {
  const router = useRouter();
  const { openModal } = useModal();

  const [updateSuccess, setUpdateSuccess] = useState({
    status: 'success',
    message: ''
  });

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
      }

      router.push({ pathname: '/register', query: { minerKey } });
    } catch (error) {}
  };

  const handleDelete = async (miner_key: string): Promise<void> => {
    // Send a request to delete the device from the backend
    try {
      console.log(`Delete ${miner_key}`);
      const response = await fetch(`/api/devices/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ miner_key: miner_key })
      });

      const data = await response.json();
      console.log(data);
      if (response.ok) {
        if (data.result === 'ok') {
          setUpdateSuccess({ status: 'success', message: data.message });
          setTimeout(() => {
            router.reload();
          }, 15_000);
        } else {
          setUpdateSuccess({ status: 'error', message: data.message });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 15_000);
        }
      } else {
        setUpdateSuccess({ status: 'error', message: data.message });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 15_000);
      }
    } catch (error) {
      console.error('Error deleting device:', error);
      setUpdateSuccess({
        status: 'error',
        message: 'Error occured during deleting.'
      });
      setTimeout(() => {
        setUpdateSuccess({ status: 'error', message: '' });
      }, 15_000);
    }
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

      router.push({ pathname: '/register', query: { minerKey: miner_key } });
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
          <p className="text-lg">Explanation for about onboarding miners</p>
        </Flex>
      </div>
      <Flex
        flexDirection="row"
        justifyContent="evenly"
        className="flex-wrap px-20 mt-10"
      >
        <div className="rounded-xl p-5 shadow-md shadow-gray-600 min-w-[200px] ">
          <Title className="text-white">Your Miners</Title>
          <p>{devices.length}</p>
        </div>
        <div className="rounded-xl p-5 shadow-md shadow-red-600 min-w-[200px] ">
          <Title className="text-white">Unverified Miners</Title>
          <p>{devices.length}</p>
        </div>
        <div className="rounded-xl p-5 shadow-md shadow-green-600 min-w-[200px] ">
          <Title className="text-white">Verified Miners</Title>
          <p>{devices.filter((device) => device.verified).length}</p>
        </div>
      </Flex>

      <div className="w-full mt-10 px-20">
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
      <OnboardDeviceList
        devices={devices}
        handleDelete={handleDelete}
        handleChange={handleChange}
      />
      <AddDeviceModal modalName="addDevice" handleRegister={handleRegister} />
    </div>
  );
};

export async function getServerSideProps(context: any) {
  const testMode = process.env.TEST_MODE && process.env.TEST_MODE === 'true';
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

    console.log(devices);
    if (!devices) {
      return {
        props: {
          devices: []
        }
      };
    } else {
      return {
        props: {
          devices: JSON.parse(
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
