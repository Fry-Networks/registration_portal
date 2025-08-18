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
import { useToastContext } from '../../hooks/ToastContext';

interface EcowittModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (apiKey: string, appKey: string) => Promise<boolean>;
}

const EcowittModal: React.FC<EcowittModalProps> = ({
  modalName,
  minerKey,
  handle
}: EcowittModalProps) => {
  const toast = useToastContext();
  const { modals, closeModal } = useModal();
  const [apiKey, setApiKey] = useState('');
  const [appKey, setAppKey] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'ecowitt' })
        });
  
        const result = await response.json();
        if (result.data !== null) {
          setApiKey(result.data.api_key);
          setAppKey(result.data.app_key);
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
    const result = await handle(apiKey, appKey);
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
        <Title className="mb-5">Ecowitt Weather</Title>
        <Subtitle className='mb-2 text-[14px]'>
          Your API / APP Key only allows access to your devices data. You can verify that{' '}
          <Link href='https://doc.ecowitt.net/web/#/apiv3en?page_id=1' target='_blank' className='underline'>
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
          // error={apiKey !== "" && !/\b^[a-z0-9]{64}$\b/gm.test(apiKey)}
          // errorMessage="Invalid API key"
        />
        <TextInput
          type="text"
          value={appKey}
          onChange={(e) => setAppKey(e.target.value)}
          placeholder="Enter your APP key"
          className="mt-2 mb-2 text-slate-900"
          // error={appKey !== "" && !/\b^[a-z0-9]{64}$\b/gm.test(appKey)}
          // errorMessage="Invalid API key"
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
            disabled={apiKey == "" || appKey == ""}
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

export default EcowittModal;