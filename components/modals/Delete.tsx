import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { Device } from '../../lib/types';
import MessageUpdate from '../messageUpdate';
import { useSession } from 'next-auth/react';

export default function DeleteModal({
  modalName,
  miner_key,
  handleDelete
}: {
  modalName: string;
  miner_key: string;
  handleDelete: (miner_key: string) => Promise<void>;
}) {
  const { modals, closeModal } = useModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState({
    status: 'success',
    message: ''
  });
  const { data: session } = useSession();

  const unRegisterDevice = async () => {
    console.log('Deleting');
    setIsProcessing(true);
    try {
      const response = await fetch(`/api/devices/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          miner_key: miner_key,
          address: session?.user.address
        })
      });

      const data = await response.json();
      console.log(data);
      if (response.ok) {
        if (data.result === 'ok') {
          closeModal(modalName);
          handleDelete(miner_key);
        } else {
          setUpdateSuccess({ status: 'error', message: data.message });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);
        }
      } else {
        setUpdateSuccess({ status: 'error', message: data.message });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 5_000);
      }
      setIsProcessing(false);
      return;
    } catch (error) {
      setUpdateSuccess({
        status: 'error',
        message: 'Error on server side'
      });
      setTimeout(() => {
        setUpdateSuccess({ status: 'error', message: '' });
      }, 5_000);

      setIsProcessing(false);
      return;
    }
  };

  return (
    <div>
      <Dialog
        open={modals[modalName]}
        onClose={() => {
          !isProcessing && closeModal(modalName);
        }}
        static={true}
        className="z-[100]"
      >
        <DialogPanel className="sm:max-w-xl">
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
          <Title className="mb-5">Un-Register Device</Title>
          <div className="px-2 sm:px-20">
            <MessageUpdate updateSuccess={updateSuccess} />
          </div>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            <p>Do you want to un-register the device?</p>
          </Flex>
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
              className={`relative flex items-center justify-center bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 ${
                isProcessing ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              onClick={() => unRegisterDevice()}
            >
              {isProcessing ? (
                <svg
                  className="animate-spin h-6 w-6 text-red-500"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <defs>
                    <linearGradient
                      id="redGradient"
                      x1="0%"
                      y1="0%"
                      x2="100%"
                      y2="0%"
                    >
                      <stop offset="0%" stopColor="#ff0000" />
                      <stop offset="50%" stopColor="#ff4d4d" />
                      <stop offset="100%" stopColor="#ff9999" />
                    </linearGradient>
                  </defs>
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="url(#redGradient)"
                    strokeWidth="4"
                    fill="none"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                'Delete'
              )}
            </Button>
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
