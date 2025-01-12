import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import algosdk from 'algosdk';
import { useModal } from '../../app/modalcontext';
import { useState } from 'react';
import { useSession } from 'next-auth/react';
import { RiCloseLine } from '@remixicon/react';
import { Device } from '../../lib/types';
import MessageUpdate from '../messageUpdate';
import { useToastContext } from '../../hooks/ToastContext';
import { algodClient, getWalletAddress } from '../../lib/utils';
import { 
  useWallet,
 } from '@txnlab/use-wallet'

const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export default function ClaimModal({
  modalName,
  miner_key,
  no,
  handleClaim
}: {
  modalName: string;
  miner_key: string;
  no?: number;
  handleClaim: (ret: boolean, message: string) => Promise<void>;
}) {
  const { activeAddress, signTransactions, sendTransactions } = useWallet()
  const { modals, closeModal } = useModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const { data: session } = useSession();
  const toast = useToastContext();

  const requestGasFee = async (from: string | undefined): Promise<boolean> => {
    try {
  
      if (from === undefined)
        return false;
  
      const suggestedParams = await algodClient.getTransactionParams().do();
      const to = getWalletAddress(process.env.REWARD_MNEMONIC!);
  
      const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
        from: from,
        to: to,
        amount: Number(1000), // Amount in microAlgos
        suggestedParams: suggestedParams,
      });
  
      const encodedTxn = algosdk.encodeUnsignedTransaction(txn);
      const signedTransactions = await signTransactions([encodedTxn]);
      const waitRoundsToConfirm = 4;
  
      const { id, txId } = await sendTransactions(
        signedTransactions,
        waitRoundsToConfirm
      );
  
      console.log('Fee payment txId: ', txId, id);
  
      if (txId) {
        return true;
      }
      return false;
    } catch(error) {
      console.error ("getGasFee : ", error);
      return false;
    }
  }

  const claimRewards = async () => {
    setIsProcessing(true);
    try {

      if (!testMode) {
        console.log('activeAddress : ', activeAddress, session?.user.address);
        const isFeePaid = await requestGasFee(activeAddress);
        if (!isFeePaid) {
          toast.error({ heading: 'Fee Payment Error', message: `Failed to pay transaction fee ${activeAddress}` });
          
          setIsProcessing(false);
          return;
        }
      }

      const response = await fetch('api/rewards/claim', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(
          no ? { miner_key: miner_key, no: no } : { miner_key: miner_key }
        )
      });

      const result = await response.json();
      if (!response.ok) {
        toast.error({ heading: 'Claim Error', message: result.message });

        setIsProcessing(false);
        return;
      }

      const theMsg =
        'Claimed successfully. TxId: ' +
        result.result;

      if (result.success) {
        toast.success({ heading: 'Claim Success', message: `${theMsg}` });
        setIsProcessing(false);
        closeModal(modalName);
        handleClaim(true, theMsg);
      } else {
        toast.error({ heading: 'Claim Error', message: result.message });
        setIsProcessing(false);
        return;
      }
    } catch (error) {
      toast.error({ heading: 'Claim Error', message: 'Error on server side' });

      setIsProcessing(false);
      return;
    }
    setIsProcessing(false);
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
          <Title className="mb-5">Claim Rewards</Title>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className="gap-3 w-full mt-5 text-slate-900"
          >
            <p>Do you want to claim the rewards?</p>
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
              onClick={() => claimRewards()}
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
                'Claim'
              )}
            </Button>
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
