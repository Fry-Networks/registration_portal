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
import { useModal } from '../../app/modalcontext';
import Loading from '../../components/Loading';

interface NrfModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (token: string, deviceId: string) => Promise<boolean>;
}

const NrfModal: React.FC<NrfModalProps> = ({
  modalName,
  minerKey,
  handle
}: NrfModalProps) => {
  const { modals, closeModal } = useModal();
  const [token, setToken] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'nrf' })
        });
  
        const result = await response.json();
        if (result.data !== null) {
          setToken(result.data.token);
          setDeviceId(result.data.id);
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
    const result = await handle(token, deviceId);
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
        <Title className="mb-5">Nrf Credentials</Title>
        <TextInput
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Enter your API key"
          className="mt-2 mb-2 text-slate-900"
          error={token !== "" && !/\b[A-Za-z0-9]{40}$\b/gm.test(token)}
          errorMessage="Invalid Token"
        />
        <TextInput
          type="text"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder="Enter your device id"
          className="mt-2 mb-2 text-slate-900"
          error={deviceId !== "" && !/\bnrf-\d{15}$\b/gm.test(deviceId)}
          errorMessage="Invalid Device ID key"
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
            disabled={!/\b[A-Za-z0-9]{40}$\b/gm.test(token) || !/\bnrf-\d{15}$\b/gm.test(deviceId)}
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

export default NrfModal;