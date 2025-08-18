import React, { useEffect, useState } from 'react';
import Link from 'next/link';
// import { useAppKit, useWalletInfo } from '@reown/appkit/react';
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
// import { walletModal } from '../../pages/_app';

interface PebbleModalProps {
  modalName: string;
  minerKey: string | string[] | undefined;
  handle: (imei: string, ercAddr: string) => Promise<boolean>;
}

const PebbleModal: React.FC<PebbleModalProps> = ({
  modalName,
  minerKey,
  handle
}: PebbleModalProps) => {
  // const { open, close } = useAppKit();
  const { modals, closeModal } = useModal();
  const [imei, setImei] = useState('');
  const [ercAddr, setErcAddr] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_HOST}/api/getDeviceCredential`, {
          method: 'POST',
          headers: {'Content-type': 'application/json'},
          body: JSON.stringify({ miner_key: minerKey, type: 'pebble' })
        });
  
        const result = await response.json();
        if (result.data !== null) {
          setImei(result.data.imei);
          setErcAddr(result.data.owner);
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
    const result = await handle(imei, ercAddr);
    if (result) {
      setIsProcessing(false);
      closeModal(modalName);
    }
    setIsProcessing(false);
  }

  // const state = walletModal.getState();
  // console.log(state);

  // let accountState = {};
  // walletModal.subscribeAccount(state => {
  //   accountState = state;

  //   if (accountState && accountState['isConnected'] === true) {
  //     setErcAddr(accountState['address']);
  //   } else {
  //     setErcAddr('');
  //   }
  // })

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
        <Title className="mb-5">Pebble Device</Title>
        <Subtitle className='mb-2 text-[14px]'>
          Your imei only allows access to your devices data. You can verify that{' '}
          <Link href='https://docs.iotex.io/dev-toolkit/web3-smart-devices/pebble-tracker/endpoints' target='_blank' className='underline'>
            here
          </Link>
          .
        </Subtitle>
        <TextInput
          type="text"
          value={imei}
          onChange={(e) => setImei(e.target.value)}
          placeholder="Enter your imei"
          className="mt-2 mb-2 text-slate-900"
          error={imei !== "" && !/\b^[0-9]{15}$\b/gm.test(imei)}
          errorMessage="Invalid imei key"
        />
        {/* <Subtitle className='mt-5 mb-2 text-[14px]'>You will have to connect with the wallet you used to register your Pebble Tracker (on the Machine Fi portal) to ensure ownserhip of the device.</Subtitle> */}
        <Subtitle className='mt-5 mb-2 text-[14px]'>You will have to input the wallet address you used to register your Pebble Tracker (on the Machine Fi portal) to ensure ownserhip of the device.</Subtitle>
        <TextInput
          type="text"
          value={ercAddr}
          onChange={(e) => setErcAddr(e.target.value)}
          placeholder="Enter your wallet address"
          className="mt-2 mb-2 text-slate-900"
          error={ercAddr !== "" && ( !/\b^0x[a-fA-F0-9]{40}$\b/gm.test(ercAddr) && !/\b^io1[0-9a-z]{38}$\b/gm.test(ercAddr))}
          // error={ercAddr !== "" && !/\b^io1[0-9a-z]{38}$\b/gm.test(ercAddr)}
          errorMessage="Invalid wallet address"
        />
        {/* {ercAddr !== '' ? 
          <Flex 
            flexDirection='row'
          >
            <Subtitle className='mb-2 text-[14px] text-black'>{ercAddr}</Subtitle> 
            <Button
              className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={() => {walletModal.disconnect()}}
            >
              {'Disconnect'}
            </Button>
          </Flex>
          :
          (
            <Button
              className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={() => {open()}}
            >
              {'Connect EVM Wallet'}
            </Button>
          )
        } */}
        
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
            disabled={!/\b^[0-9]{15}$\b/gm.test(imei) || (!/\b^0x[a-fA-F0-9]{40}$\b/gm.test(ercAddr) && !/\b^io1[0-9a-z]{38}$\b/gm.test(ercAddr))}
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

export default PebbleModal;