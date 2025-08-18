import React, { useEffect, useState } from 'react';
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

interface AtmotubeModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (token: string, deviceId: string) => Promise<boolean>;
}

const AtmotubeModal: React.FC<AtmotubeModalProps> = ({
  modalName,
  minerKey,
  handle
}: AtmotubeModalProps) => {
  const { modals, closeModal } = useModal();
  const [token, setToken] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      console.log('Ambient');
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'atmotube' })
        });
  
        const result = await response.json();
        console.log('result : ', result);
        if (result.data !== null) {
          setToken(result.data.token);
          setDeviceId(result.data.deviceId);
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
        <Title className="mb-5">Atmotube Credentials</Title>
        <TextInput
          type="text"
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder="Enter your device id"
          className="mt-2 mb-2 text-slate-900"
          error={deviceId !== "" && !/\b^([0-9A-Za-z]{2}:){5}[0-9A-Za-z]{2}$\b/gm.test(deviceId)}
          errorMessage="Invalid Device ID"
        />
        <TextInput
          type="text"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="Enter your token"
          className="mt-2 mb-2 text-slate-900"
          error={token !== "" && !/\b^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}$\b/gm.test(token)}
          errorMessage="Invalid Token"
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
            disabled={!/\b^([0-9A-Za-z]{2}:){5}[0-9A-Za-z]{2}$\b/gm.test(deviceId) || !/\b^[0-9a-z]{8}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{12}$\b/gm.test(token)}
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

export default AtmotubeModal;