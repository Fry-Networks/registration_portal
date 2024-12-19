import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useEffect, useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { Device } from '../../lib/types';
import MessageUpdate from '../messageUpdate';
import { useSession } from 'next-auth/react';
import algosdk, { Account } from 'algosdk';

export default function GenerateWallet({
  modalName,
  saveGenerateWallet
}: {
  modalName: string;
  saveGenerateWallet: (mnemonic: string) => void;
}) {
  const { modals, closeModal } = useModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [account, setAccount] = useState<Account | undefined>(undefined);
  const [mnemonic, setMnemonic] = useState('');
  const { data: session } = useSession();

  const handleGenerate = () => {
    const account = algosdk.generateAccount();
    setAccount(account);
  };

  useEffect(() => {
    if (account === undefined) {
      setMnemonic('');
      return;
    }

    const privateKey = account.sk;
    const address = account.addr;

    const mnemonic = algosdk.secretKeyToMnemonic(privateKey);

    setMnemonic(mnemonic);
  }, [account]);

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
              onClick={() => {
                if (!isProcessing) {
                  setAccount(undefined);
                  closeModal(modalName);
                }
              }}
              aria-label="Close"
            >
              <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
            </button>
          </div>
          <Title className="mb-3">Generate New Wallet</Title>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className="gap-3 w-full mt-2 "
          >
            <p>Genreate new wallet that you can use for PoC wallet</p>
          </Flex>
          {mnemonic && (
            <div className="mt-1">
              <strong>Generated Wallet Address: </strong>
              <p className="sm:text-sm hidden sm:block">{account?.addr}</p>
              <p className="sm:text-sm block sm:hidden">{`${account?.addr.slice(0, 14)} ... ${account?.addr.slice(account?.addr.length - 15, account?.addr.length - 1)}`}</p>
            </div>
          )}
          <Flex
            flexDirection="row"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            <Button
              className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={() => {
                if (!isProcessing) {
                  setAccount(undefined);
                  closeModal(modalName);
                }
              }}
            >
              Close
            </Button>
            <Button
              className={`relative flex items-center justify-center bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 ${
                isProcessing ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              onClick={() => handleGenerate()}
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
              ) : !account ? (
                'Generate'
              ) : (
                'Regenerate'
              )}
            </Button>
            {account && (
              <Button
                className={`relative flex items-center justify-center bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 ${
                  isProcessing ? 'cursor-not-allowed' : 'cursor-default'
                }`}
                onClick={() => {
                  saveGenerateWallet(mnemonic);
                  setAccount(undefined);
                  closeModal(modalName);
                }}
              >
                Save
              </Button>
            )}
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
