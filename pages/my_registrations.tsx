import { Title, Text, Button, Card, Dialog, DialogPanel, TextInput, Callout } from '@tremor/react';
import { useWallet } from '@txnlab/use-wallet';
import { useSession, signIn, getSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import clientPromise from '../lib/mongoclient';
import { RiCloseLine } from '@remixicon/react';
import { CheckCircleIcon } from '@heroicons/react/24/outline';

export default function MyRegistrationsPage({ devices }: { devices: Device[] }) {
  const { data: session, status } = useSession();
  const { activeAccount } = useWallet();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<Device | null>(null);
  const [rewardWallet, setRewardWallet] = useState('');
  const [isValid, setIsValid] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState("");
  useEffect(() => {
    if (activeAccount && !session) {
      signIn('wallet');
    }
  }, [activeAccount, session]);

  useEffect(() => {
    // Validate the reward wallet using the regex
    const regex = /^[A-Z0-9]{58}$/;
    setIsValid(regex.test(rewardWallet));
  }, [rewardWallet]);

  const handleOpenModal = (device: Device) => {
    setCurrentDevice(device);
    setRewardWallet(device.reward_wallet || '');
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setCurrentDevice(null);
    setRewardWallet('');
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
        setUpdateSuccess("Reward Wallet");
        handleCloseModal();
      } else {
        setUpdateSuccess("error");
        console.error('Failed to update reward wallet');
      }
    } catch (error) {
      setUpdateSuccess("error");
      console.error('An error occurred while updating the reward wallet', error);
    }
  };

  if (status === 'loading') {
    return <p>Loading...</p>;
  }

  console.log(devices);

  return (
    <main className="p-4 md:p-10 mx-auto max-w-7xl">
      {session ? (
        <>
          <Title className="mb-20">My Registrations ({session.user.address})</Title>
          {(updateSuccess != "" && updateSuccess != "error") && (
            <Callout className="mt-4" title="Success" icon={CheckCircleIcon} color="teal">
              Successfully updated {updateSuccess} !
            </Callout>
          )}
          {(updateSuccess == "error") && (
            <Callout className="mt-4" title="Error" icon={CheckCircleIcon} color="red">
              An error occured during the update!
            </Callout>
          )}
          {devices && devices.length > 0 ? (
            devices.map((device) => (
              <Card key={device._id} className="mb-4">
                <Title>{device.name}</Title>
                <Text>Miner Key: {device.miner_key}</Text>
                <Text>Creation date: {new Date(device.created_at).toLocaleDateString()}</Text>
                <Text>Is registered: {device.is_registered ? 'Yes' : 'No'}</Text>
                <Text>Reward wallet: {device.reward_wallet ?? 'None'}</Text>
                <Button onClick={() => handleOpenModal(device)}>Update reward wallet</Button>
              </Card>
            ))
          ) : (
            <p>No devices found</p>
          )}
        </>
      ) : (
        <Title className="mb-20">Please connect your wallet and authenticate</Title>
      )}

      <Dialog
        open={isModalOpen}
        onClose={handleCloseModal}
        static={true}
        className="z-[100]"
      >
        <DialogPanel className="sm:max-w-2xl"> {/* Changed from sm:max-w-md to sm:max-w-lg */}
          <div className="absolute right-0 top-0 pr-3 pt-3">
            <button
              type="button"
              className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
              onClick={handleCloseModal}
              aria-label="Close"
            >
              <RiCloseLine
                className="h-5 w-5 shrink-0"
                aria-hidden={true}
              />
            </button>
          </div>
          <form onSubmit={handleUpdateRewardWallet}>
            <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
              Update Reward Wallet
            </h4>
            <TextInput
              type="text"
              value={rewardWallet}
              onChange={(e) => setRewardWallet(e.target.value)}
              placeholder="Enter new reward wallet"
              className="mt-2"
            />
            <Button type="submit" className={`mt-4 w-full ${isValid ? '' : 'bg-blue-300 cursor-not-allowed'}`} disabled={!isValid}>
              Update
            </Button>
          </form>
        </DialogPanel>
      </Dialog>

    </main>
  );
}


export async function getServerSideProps(context: any) {
  const session = await getSession(context);
  console.log(session);
  if (!session || !session.user.address) {
    return {
      props: {},
    };
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const devices = await db.collection('devices').find({ address: session.user.address }).toArray();
    console.log(JSON.parse(JSON.stringify(devices)));
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
  created_at: Date;
  reward_wallet: string;
  is_registered: boolean;
  address: string;
  email: string;
  __v: number;

}