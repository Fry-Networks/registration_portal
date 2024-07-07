import {

  Title,
  TextInput,
  Button,
  Flex
} from '@tremor/react';
import { useState } from 'react';
import MessageUpdate from '../components/messageUpdate';
import HardwareREG from '../components/modals/registrations/hardware';
import { useModal } from '../app/modalcontext';
import { useWallet } from '@txnlab/use-wallet';
import ApiKeyREG from '../components/modals/registrations/apikey';
export default function NewRegistrationPage() {
  const [minerKey, setMinerKey] = useState('');
  const { openModal, closeModal } = useModal();
  const { activeAccount } = useWallet();
  const isValid = /\b([A-Z]{2,6})-[A-Z0-9]{32}\b/gm.test(minerKey);
  const [updateSuccess, setUpdateSuccess] = useState({ status: 'success', message: '' });

  const startRegistration = async () => {
    if (!activeAccount) {
      setUpdateSuccess({ status: 'error', message: 'Please connect your wallet' });
      return;
    }
    const response = await getMinerType(minerKey, activeAccount.address);
    console.log(response);
    if (response.message === 'ok') {

      openModal(response.type + 'REG')
    } else {
      setUpdateSuccess({ status: 'error', message: response.message });
    }

  }
  return (
    <main className="p-4 md:p-10 mx-auto max-w-7xl">
      <Title className='mb-20' >Create a new registration</Title>
      <MessageUpdate updateSuccess={updateSuccess} />
      <Flex flexDirection='col' justifyContent='center' alignItems='center'>
        <TextInput className="mx-auto max-w-sm mb-4" placeholder='Miner-key' value={minerKey} onChange={(e) => setMinerKey(e.target.value)} />
        <Button
          disabled={!isValid}
          onClick={startRegistration}
        >Start registration</Button>
      </Flex>

      <HardwareREG
        modalName='hardwareREG'
        minerKey={minerKey}
        address={activeAccount?.address}
      />

      <ApiKeyREG
        modalName='apiKeyREG'
        minerKey={minerKey}
        address={activeAccount?.address}
      />


    </main>
  );
}


const getMinerType = async (miner_key: string, address: string) => {
  const response = await fetch('/api/miner_types', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ miner_key, address: address })
  });
  const data = await response.json();
  return data;
}