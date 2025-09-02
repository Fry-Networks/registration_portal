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
import { useModal } from '../../../app/modalcontext';
import Loading from '../../Loading';

interface TempestModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (stationId: string, token: string) => Promise<boolean>;
}

const TempestModal: React.FC<TempestModalProps> = ({
  modalName,
  minerKey,
  handle
}: TempestModalProps) => {
  const { modals, closeModal } = useModal();
  const [stationId, setStationId] = useState('');
  const [token, setToken] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'tempest' })
        });
        const result = await response.json();
        if (result.data !== null) {
          setStationId(result.data.station_id || '');
          setToken(result.data.token || '');
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
    const result = await handle(stationId, token);
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
            <span style={{ display: 'inline-flex', height: 20, width: 20 }}>
              <RiCloseLine aria-hidden={true} />
            </span>
          </button>
        </div>
        <Title className="mb-5">Tempest Weather</Title>
        <Subtitle className='mb-2 text-[14px]'>
          Your Station ID and API Token only allow access to your device's data. You can find these in your Tempest dashboard. For more info, see the{' '}
          <Link href='https://weatherflow.github.io/Tempest/api/' target='_blank' className='underline'>Tempest API documentation</Link>.
        </Subtitle>
        <TextInput
          type="text"
          value={stationId}
          onValueChange={setStationId}
          placeholder="Enter your station ID"
          error={stationId !== '' && !/^\d+$/.test(stationId)}
          errorMessage="Invalid Station ID"
        />
        <TextInput
          type="text"
          value={token}
          onValueChange={setToken}
          placeholder="Enter your API token"
          error={token !== '' && !/^([a-zA-Z0-9\-_]{32,})$/.test(token)}
          errorMessage="Invalid API token"
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
            disabled={!/^\d+$/.test(stationId) || !/^([a-zA-Z0-9\-_]{32,})$/.test(token)}
            onClick={() => {
              handleSubmit();
            }}
          >
            {isProcessing ? <Loading/> : 'Submit'}
          </Button>
        </Flex>
      </DialogPanel>
    </Dialog>
  );
};

export default TempestModal;
