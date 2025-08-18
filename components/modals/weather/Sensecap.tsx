import React, { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogPanel,
  TextInput,
  Title,
  Flex
} from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../../app/modalcontext';
import Loading from '../../../components/Loading';

interface SensecapModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (deviceId: string, token: string, apiKey: string) => Promise<boolean>;
}

const SensecapModal: React.FC<SensecapModalProps> = ({
  modalName,
  minerKey,
  handle
}: SensecapModalProps) => {
  const { modals, closeModal } = useModal();
  const [token, setToken] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'sensecap' })
        });
  
        const result = await response.json();
        if (result.data !== null) {
          setApiKey(result.data.password);
          setToken(result.data.username);
          setDeviceId(result.data.deviceID);
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
    const result = await handle(deviceId, token, apiKey);
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
        <Title className="mb-5">Sensecap Credentials</Title>
        <TextInput
          type="text"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder="Enter your device id"
          className="mt-2 mb-2 text-slate-900"
          error={deviceId !== "" && !/\b^[0-9A-Fa-f]{16}$\b/gm.test(deviceId)}
          errorMessage="Invalid Device ID"
        />
        <TextInput
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Enter your api id"
          className="mt-2 mb-2 text-slate-900"
          error={token !== "" && !/\b^[A-Z0-9]{16}$\b/gm.test(token)}
          errorMessage="Invalid API ID"
        />
        <TextInput
          type="text"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Enter your api key"
          className="mt-2 mb-2 text-slate-900"
          error={apiKey !== "" && !/\b^[0-9A-Fa-f]{64}$\b/gm.test(apiKey)}
          errorMessage="Invalid API Key"
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
            disabled={!/\b^[0-9A-Fa-f]{16}$\b/gm.test(deviceId) || !/\b^[A-Z0-9]{16}$\b/gm.test(token) || !/\b^[0-9A-Fa-f]{64}$\b/gm.test(apiKey)}
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

export default SensecapModal;