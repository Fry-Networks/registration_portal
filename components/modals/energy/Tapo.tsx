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

interface TapoModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (email: string, pass: string, deviceIP: string) => Promise<boolean>;
}

const TapoModal: React.FC<TapoModalProps> = ({
  modalName,
  minerKey,
  handle
}: TapoModalProps) => {
  const { modals, closeModal } = useModal();
  const [email, setEmail] = useState('');
  const [deviceIP, setDeviceIP] = useState('');
  const [pass, setPass] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'tapo' })
        });
  
        const result = await response.json();
        if (result.data !== null) {
          setEmail(result.data.email);
          setPass(result.data.password);
          setDeviceIP(result.data.deviceIp);
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
    const result = await handle(email, pass, deviceIP);
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
        <Title className="mb-5">TP-Link Tapo</Title>
        <Subtitle className='mb-2 text-[14px]'>
          Please enter TP-Link Tapo credentials below:
        </Subtitle>
        <TextInput
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter Your Email"
          className="mt-2 mb-2 text-slate-900"
          error={email !== "" && !/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$\b/gm.test(email)}
          errorMessage="Invalid Email"
        />
        <TextInput
          type="text"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          placeholder="Enter Your Password"
          className="mt-2 mb-2 text-slate-900"
          // error={pass !== "" && !/\b^[a-zA-Z0-9]{40}$\b/gm.test(pass)}
          // errorMessage="Invalid Password"
        />
        <TextInput
          type="text"
          value={deviceIP}
          onChange={(e) => setDeviceIP(e.target.value)}
          placeholder="Enter Your Device IP"
          className="mt-2 mb-2 text-slate-900"
          // error={deviceIP !== "" && !/\b^[a-zA-Z0-9]{40}$\b/gm.test(deviceIP)}
          // errorMessage="Invalid Device IP"
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
            disabled={ !/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$\b/gm.test(email) || pass == "" || deviceIP == "" }
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

export default TapoModal;