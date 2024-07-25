import { Title, Text, Button, Card, Dialog, DialogPanel, TextInput, Callout, Flex, Select, MultiSelect, MultiSelectItem } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet';
import { useSession, signIn, getSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import clientPromise from '../lib/mongoclient';
import { RiCloseLine } from '@remixicon/react';
import { CheckCircleIcon, XCircleIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import UpdateRewardModal from '../components/modals/rewardWallet';
import VerificationModal from '../components/modals/Verification';
import { useModal } from '../app/modalcontext';
import VerificationBurn from '../components/modals/VerificationBurn';
import MessageUpdate from '../components/messageUpdate';
import NameChangeModal from '../components/modals/NameChange';

export default function MyRegistrationsPage({ devices }: { devices: Device[] }) {
  const { data: session, status } = useSession();
  const { activeAccount } = useWallet();
  const { openModal, closeModal } = useModal();

  const [currentDevice, setCurrentDevice] = useState<Device | null>(null);
  const [rewardWallet, setRewardWallet] = useState('');
  const [isValid, setIsValid] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState({ status: 'success', message: '' });
  const [minerTypes, setMinerTypes] = useState([{ name: '', key: '' }]);
  const [typeFilter, setTypeFilter] = useState(['ALL']);
  const [miscFilter, setMiscFilter] = useState(['ALL']);
  const [filter, setFilter] = useState('');
  const [filteredDevices, setFilteredDevices] = useState<Device[]>(devices);

  useEffect(() => {
    const regex = /^[A-Z0-9]{58}$/;
    setIsValid(regex.test(rewardWallet));
  }, [rewardWallet]);

  useEffect(() => {
    if (activeAccount && !session) {
      signIn('wallet');
    }
    if (!activeAccount) return;
    const fetchMinerTypes = async () => {
      const response = await fetch('/api/get_miner_types', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ address: activeAccount?.address }),
      });
      if (response.ok) {
        const data = await response.json();
        setMinerTypes(data.data as { name: string, key: string }[]);
      }
    };
    fetchMinerTypes();

  }, [activeAccount, session]);


  useEffect(() => {
    let updatedDevices = devices.filter(device => {
      return (filter.length > 0 ? device.reward_wallet?.includes(filter) : true) &&
        (typeFilter.includes('ALL') || typeFilter.includes(device.miner_key.split('-')[0])) &&
        (miscFilter.includes('ALL') || (miscFilter.some(filter => {
          const split = filter.split('!')[1]
          return filter.startsWith('!') ? !miscFilter.includes(split)&& !(device as any)[split] : (device as any)[filter];
        })
        ));
    }
    )
    updatedDevices.sort((a, b) => {
      if(a.nickname) {
        if(b.nickname) {
          return a.nickname.localeCompare(b.nickname);
        } else {
          return a.nickname.localeCompare(b.name);
        }
      } else {
        if(b.nickname) {
          return a.name.localeCompare(b.nickname);
        } else {
          return a.name.localeCompare(b.name);
        }
      }
    });
    setFilteredDevices(updatedDevices);
  }, [filter, devices, typeFilter, miscFilter]);





  const handleOpenModal = (device: Device, modalName: string) => {
    setCurrentDevice(device);
    openModal(modalName);
  };


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
        setRewardWallet('');
        setUpdateSuccess({ status: 'success', message: 'reward wallet' });
        closeModal('updateReward');
      } else {
        setUpdateSuccess({ status: 'error', message: 'reward wallet' });
        console.error('Failed to update reward wallet');
      }
    } catch (error) {
      setUpdateSuccess({ status: 'error', message: 'reward wallet' });
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
        setUpdateSuccess({ status: 'success', message: 'position' });
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
          <Flex justifyContent="end" className="mb-4">
            <TextInput
              placeholder="Filter by reward wallet"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full md:w-auto"
            />
            <Flex flexDirection='col' justifyContent='center' alignItems='end'>
              <MultiSelect
                className="w-full md:w-1/2 mb-2"
                value={typeFilter}
                onValueChange={(val) => setTypeFilter(val)}
              >
                <MultiSelectItem value="ALL">ALL</MultiSelectItem>
                {minerTypes.map((miner) => (
                  <MultiSelectItem value={miner.key}>{miner.key} - {miner.name}</MultiSelectItem>
                ))}
              </MultiSelect>
              <MultiSelect
                className="w-full md:w-auto"
                value={miscFilter}
                onValueChange={(val) => setMiscFilter(val)}
              >
                <MultiSelectItem value="ALL">ALL</MultiSelectItem>
                <MultiSelectItem value="is_registered">Registered</MultiSelectItem>
                <MultiSelectItem value="verified">Verified</MultiSelectItem>
                <MultiSelectItem value="position">Position set</MultiSelectItem>
                <MultiSelectItem value="!is_registered">Not registered</MultiSelectItem>
                <MultiSelectItem value="!verified">Not verified</MultiSelectItem>
                <MultiSelectItem value="!position">Position not set</MultiSelectItem>

              </MultiSelect>
            </Flex>

          </Flex>

          {filteredDevices && filteredDevices.length > 0 ? (
            filteredDevices.map((device) => (
              <Card key={device._id} className="mb-4 relative">
                <Title>{device.nickname ? device.nickname : device.name}</Title>
                <Text>Miner Key: {device.miner_key}</Text>
                <Text>Creation date: {new Date(device.created_at).toLocaleDateString()}</Text>
                <Text>Is registered: {device.is_registered ? 'Yes' : 'No'}</Text>
                <Text>Reward wallet: {device.reward_wallet ?? 'None'}</Text>
                {device.verified && <Text>Position: {device.position?.lat}, {device.position?.lng}</Text>}
                {device.byod && <Text>BYOD: {device.byod}</Text>}

                {(!device.verified || !device.position || !device.is_registered) ? (
                  <div className="absolute top-4 right-4">
                    <Flex flexDirection='row' justifyContent='end' alignItems='end'>
                      <XCircleIcon className="h-6 w-6 text-red-500" />
                      <Flex flexDirection='col' justifyContent='end' alignItems='end' className="ml-2">
                        {!device.verified && <Text className="text-red-500">- Not verified</Text>}
                        {!device.position && <Text className="text-red-500">- Position not set</Text>}
                        {!device.is_registered && <Text className="text-red-500">- Not registered</Text>}
                      </Flex>
                    </Flex>
                  </div>
                ) : (
                  <div className="absolute top-4 right-4">
                    <Flex flexDirection='row' justifyContent='end' alignItems='end'>
                      <CheckCircleIcon className="h-6 w-6 text-green-500" />
                      <Text className="text-green-500 ml-2">Verified</Text>
                    </Flex>
                  </div>
                )}

                <Flex className="mt-4 flex-col md:flex-row" justifyContent='start' alignItems='center'>
                  <Button className="w-full md:w-auto" onClick={() => handleOpenModal(device, 'updateReward')}>Update reward wallet</Button>
                  {device.verified ?
                    <Button className="ml-2 mt-2 md:mt-0 w-full md:w-auto bg-blue-500 cursor-not-allowed" disabled>Verified</Button> :
                    <Button className="ml-2 mt-2 md:mt-0 w-full md:w-auto" onClick={() => handleOpenModal(device, 'burnVerification')}>Verify</Button>
                  }
                  <Button className="ml-2 mt-2 md:mt-0 w-full md:w-auto" onClick={() => handleOpenModal(device, 'positionVerification')}>Change location</Button>
                  <Button className="ml-2 mt-2 md:mt-0 w-full md:w-auto" onClick={() => handleOpenModal(device, 'changeName')}>Change name</Button>
                  {device?.hexId && <Button className="ml-2 mt-2 md:mt-0 w-full md:w-auto" color="yellow" onClick={() => window.open('https://explorer.frynetworks.com/hex/' + device?.hexId, '_blank')}>
                    <Flex flexDirection='row'>
                      Explorer <ArrowTopRightOnSquareIcon style={{ marginLeft: '8px', width: '1rem', height: '1rem' }} />
                    </Flex>
                  </Button>}
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
      <NameChangeModal
        modalName='changeName'
        address={activeAccount?.address}
        miner_key={currentDevice?.miner_key}
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
  nickname?: string;
  miner_key: string;
  name: string;
  byod?: string;
  created_at: Date;
  position?: {
    lat: number;
    lng: number;
  };
  verified: boolean;
  reward_wallet?: string;
  is_registered: boolean;
  hexId?: string;
  address: string;
  email: string;
  __v: number;
}