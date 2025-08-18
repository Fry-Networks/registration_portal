import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Dialog,
  DialogPanel,
  TextInput,
  Title,
  Subtitle,
  Flex
} from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../app/modalcontext';
import Loading from '../../components/Loading';

interface AmbientModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (apiKey: string) => Promise<boolean>;
}

const AmbientModal: React.FC<AmbientModalProps> = ({
  modalName,
  minerKey,
  handle
}: AmbientModalProps) => {
  const { modals, closeModal } = useModal();
  const [apiKey, setApiKey] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      console.log('Ambient');
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'ambient' })
        });
  
        const result = await response.json();
        console.log('result : ', result);
        if (result.data !== null) {
          setApiKey(result.data.api_key);
        }
      } catch (error) {
        console.error(error);
        return;
      }
      return;
    }

    if (modals[modalName]) {
      fetchData();
    }
  }, [modals[modalName], minerKey]);

  const handleSubmit = async () => {
    setIsProcessing(true);
    const result = await handle(apiKey);
    if (result) {
      setIsProcessing(false);
      closeModal(modalName);
    }
    setIsProcessing(false);
  }

  return (
    <Dialog
      open={modals[modalName]}
      onClose={() => !isProcessing && closeModal(modalName)}
      static={true}
      className="z-[100]"
    >
      <DialogPanel className="sm:max-w-2xl">
        <div className="absolute right-0 top-0 pr-3 pt-3">
          <button
            type="button"
            className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
            onClick={() => !isProcessing && closeModal(modalName)}
            aria-label="Close"
          >
            <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
          </button>
        </div>
        <Title className="mb-5">Ambient Weather</Title>
        <Subtitle className='mb-2 text-[14px]'>
          Your API Key only allows access to your devices data. You can verify that{' '}
          <Link href='https://ambientweather.docs.apiary.io/#reference/0/devices' target='_blank' className='underline'>
            here
          </Link>
          .
        </Subtitle>
        <TextInput
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter your API key"
          className="mt-2 mb-2 text-slate-900"
          error={apiKey !== "" && !/\b^[a-z0-9]{64}$\b/gm.test(apiKey)}
          errorMessage="Invalid API key"
        />
        <Flex
          flexDirection="row"
          justifyContent="center"
          className="gap-3 w-full mt-5"
        >
          <Button
            className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={() => !isProcessing && closeModal(modalName)}
          >
            Close
          </Button>
          <Button
            className={`bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 
              ${isProcessing ? 'cursor-not-allowed' : 'cursor-default'}
            `}
            disabled={!/\b^[a-z0-9]{64}$\b/gm.test(apiKey)}
            onClick={() => {
              handleSubmit();
            }}
          >
            {
              isProcessing ? (
                <Loading/>
              ) : (
                'Submit'
              )
            }
          </Button>
        </Flex>
      </DialogPanel>
    </Dialog>
  );
};

export default AmbientModal;