import {

  Title,
  TextInput,
  Button,
  Flex
} from '@tremor/react';
import { useEffect, useState } from 'react';
import MessageUpdate from '../components/messageUpdate';
import { useModal } from '../app/modalcontext';
import { useWallet } from '@txnlab/use-wallet';
import ByodConvertModal from '../components/modals/ByodConvert';
import { signIn, useSession } from 'next-auth/react';
import RegistrationModal from '../components/modals/registrations/RegistrationModal';
export default function NewRegistrationPage() {
  const [minerKey, setMinerKey] = useState('');
  const { data: session, status } = useSession();
  const { openModal, closeModal } = useModal();
  const { activeAccount } = useWallet();
  const isValid = /\b([A-Z]{2,6})-[A-Z0-9]{32}\b/gm.test(minerKey);
  const [updateSuccess, setUpdateSuccess] = useState({ status: 'success', message: '' });
  useEffect(() => {
    if (activeAccount && !session) {
      signIn('wallet');
    }
  }, [activeAccount, session]);
  
  const startRegistration = async () => {
    if (!activeAccount) {
      setUpdateSuccess({ status: 'error', message: 'Please connect your wallet' });
      return;
    }
    const response = await getMinerType(minerKey, activeAccount.address);
  
    if (response.message === 'ok') {
      openModal('registration')
    } else {
      setUpdateSuccess({ status: 'error', message: response.message });
    }

  }

  const convertByod = () => {
    if (!activeAccount) {
      setUpdateSuccess({ status: 'error', message: 'Please connect your wallet' });
      return;
    }

    openModal('byodConvert');
  }

  return (
    <main className="p-4 md:p-10 mx-auto max-w-7xl">
      <Flex className="mb-20" flexDirection='row' justifyContent='between' alignItems='center'>
        <Title className='' >Create a new registration</Title>
        <Button color="orange" onClick={convertByod}>Convert a BYOD license</Button>
      </Flex>
      <MessageUpdate updateSuccess={updateSuccess} />
      <Flex flexDirection='col' justifyContent='center' alignItems='center'>
        <TextInput className="mx-auto max-w-sm mb-4" placeholder='Miner-key' value={minerKey} onChange={(e) => setMinerKey(e.target.value)} />
        <Button
          disabled={!isValid}
          onClick={startRegistration}
        >Start registration</Button>
      </Flex>

      <RegistrationModal
        modalName='registration'
        minerKey={minerKey}
        address={activeAccount?.address}
      />
      <ByodConvertModal
        modalName='byodConvert'
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