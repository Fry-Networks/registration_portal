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
import { useModal } from '../../../app/modalcontext';
import Loading from '../../../components/Loading';

interface WeatherXMModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (email: string, password: string) => Promise<boolean>;
}

const WeatherXMModal: React.FC<WeatherXMModalProps> = ({
  modalName,
  minerKey,
  handle
}: WeatherXMModalProps) => {
  const { modals, closeModal } = useModal();
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'weatherxm' })
        });
  
        const result = await response.json();
        if (result.data !== null) {
          setPassword(result.data.password);
          setEmail(result.data.username);
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
    const result = await handle(email, password);
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
        <Title className="mb-5">Weather XM Credentials</Title>
        <TextInput
          type="text"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Enter your email"
          className="mt-2 mb-2 text-slate-900"
          error={email !== "" && !/\b^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$\b/gm.test(email)}
          errorMessage="Invalid API key"
        />
        <TextInput
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
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
            disabled={!/\b^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$\b/gm.test(email) || password == ""}
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

export default WeatherXMModal;