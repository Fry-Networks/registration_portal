import { Title, Text, Button, Card, Dialog, DialogPanel, TextInput, Callout, Flex } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet';
import { useSession, signIn, getSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import clientPromise from '../lib/mongoclient';
import { RiCloseLine } from '@remixicon/react';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/24/outline';
import UpdateRewardModal from '../components/modals/rewardWallet';
import VerificationModal from '../components/modals/Verification';
import { useModal } from '../app/modalcontext';
import VerificationBurn from '../components/modals/VerificationBurn';
import MessageUpdate from '../components/messageUpdate';

export default function MyRegistrationsPage({ devices }: { devices: Device[] }) {
  const { data: session, status } = useSession();
  const { activeAccount } = useWallet();
  const { openModal, closeModal } = useModal();

  const [currentDevice, setCurrentDevice] = useState<Device | null>(null);
  const [rewardWallet, setRewardWallet] = useState('');
  const [isValid, setIsValid] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState({status: 'success', message: ''});
  useEffect(() => {
    if (activeAccount && !session) {
      signIn('wallet');
    }
  }, [activeAccount, session]);

  const handleOpenModal = (device: Device, modalName: string) => {
    setCurrentDevice(device);
    openModal(modalName);
  };


  useEffect(() => {
    const regex = /^[A-Z0-9]{58}$/;
    setIsValid(regex.test(rewardWallet));
  }, [rewardWallet]);




  const handleUpdateRewardWallet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentDevice || !isValid) return;
    try {
      const response = await fetch('/api/update-reward-wallet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ miner: currentDevice.miner_key, reward_wallet: rewardWallet, address: activeAccount?.address }),
      });
      if (response.ok) {
        setUpdateSuccess({status: 'success', message: 'reward wallet'});
        closeModal('updateReward');
      } else {
        setUpdateSuccess({status: 'error', message: 'reward wallet'});
        console.error('Failed to update reward wallet');
      }
    } catch (error) {
      setUpdateSuccess({status: 'error', message: 'reward wallet'});
      console.error('An error occurred while updating the reward wallet', error);
    }
  };
  const handleVerify = async (data: { latitude: number, longitude: number }) => {
    if (!currentDevice) return;
    try {
      const response = await fetch('/api/verify-position', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...data, miner: currentDevice.miner_key, address: activeAccount?.address }),
      });
      if (response.ok) {
        setUpdateSuccess({status: 'success', message: 'position'});
        closeModal('positionVerification');
        // Optionally update the device list or show a success message
      } else {
        console.error('Failed to verify address');
      }
    } catch (error) {
      console.error('An error occurred while verifying the address', error);
    }
  };

  if (status === 'loading') {
    return <p>Loading...</p>;
  }


  return (
    <main className="p-4 md:p-10 mx-auto  flex flex-col gap-6 break-words max-w-7xl">
      {session ? (
        <>
          <Title className="mb-20 text-center">My Registrations ({session.user.address})</Title>
          <MessageUpdate updateSuccess={updateSuccess} />
          {devices && devices.length > 0 ? (
            devices.map((device) => (
              <Card key={device._id} className="mb-4 relative">
                <Title>{device.name}</Title>
                <Text>Miner Key: {device.miner_key}</Text>
                <Text>Creation date: {new Date(device.created_at).toLocaleDateString()}</Text>
                <Text>Is registered: {device.is_registered ? 'Yes' : 'No'}</Text>
                <Text>Reward wallet: {device.reward_wallet ?? 'None'}</Text>
                {device.apikey && <Text>API key: {device.apikey}</Text>}
                {device.mac && <Text>MAC: {device.mac}</Text>}
                {device.verified && <Text>Position: {device.position?.lat}, {device.position?.lng}</Text>}

                {/* Cross icon if any conditions are unmet */}
                {(!device.verified || !device.position || !device.is_registered) ? (
                  <Flex flexDirection='row' justifyContent='end' alignItems='end' className="absolute top-4 right-4">
                    
                    <Flex flexDirection='col' justifyContent='end' alignItems='end' className="ml-2">
                    <XCircleIcon className="h-6 w-6 text-red-500" />
                      {!device.verified && <Text className="text-red-500">- Not verified</Text>}
                      {!device.position && <Text className="text-red-500">- Position not set</Text>}
                      {!device.is_registered && <Text className="text-red-500">- Not registered</Text>}
                    </Flex>
                  </Flex>
                ): (
                  <Flex flexDirection='row' justifyContent='end' alignItems='end' className="absolute top-4 right-4">
                    <CheckCircleIcon className="h-6 w-6 text-green-500" />
                    <Text className="text-green-500">Verified</Text>
                  </Flex>
                )}

                <Flex className="mt-4 flex-col md:flex-row" justifyContent='start' alignItems='center'>
                  <Button className="w-full md:w-auto" onClick={() => handleOpenModal(device, 'updateReward')}>Update reward wallet</Button>
                  {device.verified ?
                    <Button className="ml-2 mt-2 md:mt-0 w-full md:w-auto bg-blue-500 cursor-not-allowed" disabled>Verified</Button> :
                    <Button className="ml-2 mt-2 md:mt-0 w-full md:w-auto" onClick={() => handleOpenModal(device, 'burnVerification')}>Verify</Button>
                  }
                  <Button className="ml-2 mt-2 md:mt-0 w-full md:w-auto" onClick={() => handleOpenModal(device, 'positionVerification')}>Change location</Button>
                </Flex>
              </Card>
            ))
          ) : (
            <p>No devices found</p>
          )}
        </>
      ) : (
        <Title className="mb-20 text-center">Please connect your wallet and authenticate</Title>
      )}

      <UpdateRewardModal
        modalName="updateReward"
        handleUpdateRewardWallet={handleUpdateRewardWallet}
        rewardWallet={rewardWallet}
        setRewardWallet={setRewardWallet}
        isValid={isValid}
      />
      <VerificationModal
        modalName="positionVerification"
        onSubmit={handleVerify}
      />
      <VerificationBurn
        modalName="burnVerification"
        miner={currentDevice?.miner_key}
      />
    </main>
  );
}


export async function getServerSideProps(context: any) {
  const session = await getSession(context);
  if (!session || !session.user.address) {
    return {
      props: {},
    };
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const devices = await db.collection('devices').find({ address: session.user.address }).toArray();
    if (!devices) {
      return {
        props: {
          devices: [],
        },
      };
    } else {
      return {
        props: { devices: JSON.parse(JSON.stringify(devices)) },
      };
    }
  } catch (e) {
    console.error(e);
    return {
      props: {},
    };
  }
}

interface Device {
  _id: string;
  user_id: string;
  miner_key: string;
  name: string;
  apikey?: string;
  mac?: string;
  created_at: Date;
  position: {
    lat: number;
    lng: number;
  };
  verified: boolean;
  reward_wallet: string;
  is_registered: boolean;
  address: string;
  email: string;
  __v: number;

}