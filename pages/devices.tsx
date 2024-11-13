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
import InformationList from '../components/InformationList';
import VerificationList from '../components/VerificationList';
import bgImg from '../assets/background.png';
import Image from 'next/image';
import Link from 'next/link';
import MessageUpdate from '../components/MessageUpdate';
import { useModal } from '../app/modalcontext';
import AddDeviceModal from '../components/modals/AddDevice';

const DevicesPage = ({ devices = [] }: { devices: Device[] }) => {
  const router = useRouter();
  const { openModal } = useModal();
  // const [devices, setDevices] = useState<Device[]>([]);
  const [view, setView] = useState<'Information' | 'Verification'>(
    'Information'
  ); // State to toggle between views

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

  const handleChange = (id: string) => {
    // Redirect to an edit page where the device details can be modified
    router.push(`/edit-device/${id}`);
  };

  return (
    <div className="w-full">
      <div className="relative flex">
        <Image
          src={bgImg}
          className="w-full h-[40vh] object-cover"
          alt="Background Image"
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-6"
        >
          <Title className="text-white text-5xl">Fry Networks Dashboard</Title>
          <p className="text-lg">
            Here you can easily register your miner to Fry Networks. Also can
            remove and edit miner too.
          </p>
        </Flex>
      </div>
      <div className="w-full relative mt-10 px-10">
        <Flex
          flexDirection="row"
          justifyContent="center"
          className="gap-3 w-full"
        >
          <p
            className={`${view === 'Information' ? 'text-xl text-red-600 hover:text-red-400 cursor-default' : 'text-white hover:text-red-600 cursor-default'}`}
            onClick={() => setView('Information')}
          >
            Information
          </p>
          <div className="h-[40px] w-[2px] bg-gradient-to-b from-transparent via-red-700 to-transparent"></div>
          <p
            className={`${view === 'Verification' ? 'text-xl text-red-600 hover:text-red-400 cursor-default' : 'text-white hover:text-red-600 cursor-default'}`}
            onClick={() => setView('Verification')}
          >
            Verification
          </p>
        </Flex>
        <Flex
          flexDirection="row"
          className="gap-3 w-auto sm:absolute top-0 right-20 mt-10 sm:mt-0"
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
      {view === 'Information' ? (
        <InformationList devices={devices} handleDelete={handleDelete} />
      ) : (
        <VerificationList devices={devices} handleDelete={handleDelete} />
      )}

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
