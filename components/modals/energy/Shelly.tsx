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

interface ShellyModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (authKey: string, serverURL: string, deviceID: string) => Promise<boolean>;
}

const ShellyModal: React.FC<ShellyModalProps> = ({
  modalName,
  minerKey,
  handle
}: ShellyModalProps) => {
  const { modals, closeModal } = useModal();
  const [authKey, setAuthKey] = useState('');
  const [deviceID, setDeviceID] = useState('');
  const [serverURL, setServerURL] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'shelly' })
        });
  
        const result = await response.json();
        if (result.data !== null) {
          setAuthKey(result.data.authKey);
          setDeviceID(result.data.deviceId);
          setServerURL(result.data.serverUrl);
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
    const result = await handle(authKey, serverURL, deviceID);
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
        <Title className="mb-5">Shelly</Title>
        <Subtitle className='mb-2 text-[14px]'>
          Please enter Shelly credentials below:
        </Subtitle>
        <TextInput
          type="text"
          value={authKey}
          onChange={(e) => setAuthKey(e.target.value)}
          placeholder="Enter Your Auth Key"
          className="mt-2 mb-2 text-slate-900"
          error={authKey !== "" && !/\b^[a-zA-Z0-9]{92}$\b/gm.test(authKey)}
          errorMessage="Invalid Auth Key"
        />
        <TextInput
          type="text"
          value={deviceID}
          onChange={(e) => setDeviceID(e.target.value)}
          placeholder="Enter Your Device ID"
          className="mt-2 mb-2 text-slate-900"
          error={deviceID !== "" && !/\b^[0-9a-f]{12}$\b/gm.test(deviceID)}
          errorMessage="Invalid Device ID"
        />
        <TextInput
          type="text"
          value={serverURL}
          onChange={(e) => setServerURL(e.target.value)}
          placeholder="Enter Your Server URL"
          className="mt-2 mb-2 text-slate-900"
          error={serverURL !== "" && !/\b^https:\/\/[a-zA-Z0-9-]+\.shelly\.cloud$\b/gm.test(serverURL)}
          errorMessage="Invalid Server URL"
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
            disabled={ !/\b^[a-zA-Z0-9]{92}$\b/gm.test(authKey) || !/\b^[0-9a-f]{12}$\b/gm.test(deviceID) || !/\b^https:\/\/[a-zA-Z0-9-]+\.shelly\.cloud$\b/gm.test(serverURL) }
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

export default ShellyModal;