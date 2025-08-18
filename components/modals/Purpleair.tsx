import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  Dialog,
  DialogPanel,
  TextInput,
  Title,
  Subtitle,
  Flex,
} from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../app/modalcontext';
import Loading from '../../components/Loading';

interface PurpleairModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (sensorId: string, readKey: string) => Promise<boolean>;
}

const PurpleairModal: React.FC<PurpleairModalProps> = ({
  modalName,
  minerKey,
  handle
}: PurpleairModalProps) => {
  const { modals, closeModal } = useModal();
  const [sensorId, setSensorId] = useState('');
  const [readKey, setReadKey] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'purple' })
        });
  
        const result = await response.json();
        if (result.data !== null) {
          setSensorId(result.data.sensor);
          setReadKey(result.data.read_key);
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
    const result = await handle(sensorId, readKey);
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
        <Title className="mb-5">PurpleAir Credentials</Title>
        <Subtitle className='mb-2 text-[14px]'>
          Please create your READ-KEY on this {' '}
          <Link href='https://develop.purpleair.com/keys' target='_blank' className='underline'>
            link
          </Link>
          .
        </Subtitle>
        <Subtitle className='mb-2 text-[14px]'>
          Your credentials allows access to your devices data. You can verify which information we have access to{' '}
          <Link href='https://api.purpleair.com/#api-sensors-get-sensor-data' target='_blank' className='underline'>
            here
          </Link>
          .
        </Subtitle>
        <TextInput
          type="text"
          value={sensorId}
          onChange={(e) => setSensorId(e.target.value)}
          placeholder="Enter your Sensor ID"
          className="mt-2 mb-2 text-slate-900"
          error={sensorId !== "" && !/\b^\d+$\b/gm.test(sensorId)}
          errorMessage="Invalid Sensor ID"
        />
        <TextInput
          type="text"
          value={readKey}
          onChange={(e) => setReadKey(e.target.value)}
          placeholder="Enter your Read key"
          className="mt-2 mb-2 text-slate-900"
          error={readKey !== "" && !/\b^[0-9A-F]{8}-[0-9A-F]{4}-[1-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$\b/gm.test(readKey)}
          errorMessage="Invalid Read key"
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
            disabled={!/\b^\d+$\b/gm.test(sensorId) || !/\b^[0-9A-F]{8}-[0-9A-F]{4}-[1-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$\b/gm.test(readKey)}
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

export default PurpleairModal;