import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Device, FryToken, Product } from '../../lib/types';
import { useModal } from '../../app/modalcontext';
import {
  Dialog,
  DialogPanel,
  Title,
  Flex,
  TextInput,
  Button
} from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import algosdk from 'algosdk';
import { getTokenBalance as getStakeAssetBalance } from '../../pages/api/algorand/get-token-balance';
import { getTokenBalance as getAlgoBalance } from '../../pages/api/algorand/get-algo-balance';
import { useSession } from 'next-auth/react';
import MessageUpdate from '../messageUpdate';
import { useWallet } from '@txnlab/use-wallet-react';
import {
  confirmTransaction,
  SEND_TXN_RESULT,
  sendAlgoTransaction,
  VERIFY_RESULT
} from '../../lib/txn';
import { useToastContext } from '../../hooks/ToastContext';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const STAKE_ADDRESS =
  'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = '';

const StakeModal = ({
  modalName,
  device,
  product,
  handleStakingUpdate
}: {
  modalName: string;
  device: Device;
  product: Product;
  handleStakingUpdate: (device: Device) => void;
}) => {
  const { activeAddress, signTransactions } = useWallet();
  const { modals, openModal, closeModal } = useModal();
  const [stakeType, setStateType] = useState('one');
  const [tokenName, setTokenName] = useState('');
  const [stakeAmount, setStakeAmount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const { data: session } = useSession();
  const toast = useToastContext();

  const MINIMUM_ALGO_BUFFER = 0.01; // Require a tiny Algo reserve to cover network fees

  const fetchTokenInformation = async (asset_id: string | undefined) => {
    console.log(asset_id);
    if (!asset_id) {
      return;
    }

    try {
      const response = await fetch('/api/tokens/get-one', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ asset_id: asset_id })
      });

      if (!response.ok) {
        setTokenName('Unknown');
      }

      const result = await response.json();
      setTokenName(result.token.name);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    if (!device) {
      return;
    }

    if (!device.staked) {
      return;
    }

    console.log('set stake type');
    setStateType(device.staked.type);
  }, [device]);

  useEffect(() => {
    if (product === undefined) {
      return;
    }

    console.log('Stake Amount initialize');

    let stakeAmount = 0;
    if (stakeType === 'one') {
      stakeAmount = product.reward.stake!.stake_one;
    } else {
      stakeAmount = product.reward.stake!.stake_two;
    }

    if (device.byod && device.byod.length > 0) {
      stakeAmount = Math.round((stakeAmount * 100) / 2) / 100;
    }

    fetchTokenInformation(product.reward.tokens?.stake);
    setStakeAmount(stakeAmount);
  }, [product, stakeType]);

  const sendTransaction = async (from: string, to: string, amount: number) => {
    try {
      const algodClient = new algosdk.Algodv2(
        '',
        'https://mainnet-api.algonode.cloud',
        ''
      );
      const suggestedParams = await algodClient.getTransactionParams().do();
      const noteInfo = {
        miner_key:
          device.miner_key.split('-')[0] +
          '-' +
          device.miner_key.split('-')[1].slice(0, 6),
        asset_id: product.reward.tokens!.stake ?? 'none',
        type: stakeType,
        from: from,
        to: to,
        amount: amount,
        date: new Date(Date.now())
      };

      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));

      const transaction =
        algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          sender: from,
          receiver: to,
          amount: testMode ? 0 : amount * 1_000_000, // Amount in microAlgos
          note: note,
          assetIndex: Number(product.reward.tokens!.stake ?? 'none'),
          suggestedParams
        });

      const encodedTransaction = algosdk.encodeUnsignedTransaction(transaction);
      const signedTransactions = await signTransactions([encodedTransaction]);
      
      // Filter out null values and ensure we have valid signed transactions
      const validSignedTxns = signedTransactions.filter((txn): txn is Uint8Array => txn !== null);
      
      if (validSignedTxns.length === 0) {
        throw new Error('No valid signed transactions');
      }

      // Send using algodClient directly
      const response = await algodClient.sendRawTransaction(validSignedTxns[0]).do();
      const txId = response.txid;

      console.log('Successfully sent transaction. Transaction ID:', txId);
      return txId;
    } catch (error) {
      console.error('Transaction failed:', error);
      return null;
    }
  };

  const handleSubmit = async () => {
    setIsProcessing(true);
    console.log('Staking');
    try {
      if (!session || !session.user) {
        toast.error({ heading: 'Verification Error', message: 'Unauthorized' });
        setIsProcessing(false);
        return;
      }

      const asset_id = product.reward.tokens?.stake ?? 'none';

      const [stakeTokenBalance, algoBalance] = await Promise.all([
        getStakeAssetBalance(session?.user.address!, asset_id), // Pull the stake asset balance before building the transaction
        getAlgoBalance(session?.user.address!) // Ensure the wallet still has Algo to pay the fee
      ]);

      if (stakeTokenBalance === null || stakeTokenBalance < stakeAmount) {
        toast.error({
          heading: 'Verification Error',
          message: 'Insufficient staking balance in your wallet'
        });
        setIsProcessing(false);
        return;
      }

      if (algoBalance === null || algoBalance < MINIMUM_ALGO_BUFFER) {
        toast.error({
          heading: 'Verification Error',
          message: 'Not enough ALGO to cover network fees'
        });
        setIsProcessing(false);
        return;
      }

      const note = {
        action: 'Verify Staking',
        miner_key:
          device.miner_key.split('-')[0] +
          '-' +
          device.miner_key.split('-')[1].slice(0, 6),
        from: session?.user.address,
        to: STAKE_ADDRESS,
        asset_id: asset_id,
        amount: stakeAmount,
        created_at: new Date(Date.now())
      };

      const sendResult = devMode
        ? await sendAlgoTransaction(
            session?.user.address!,
            STAKE_ADDRESS,
            asset_id,
            stakeAmount,
            JSON.stringify(note),
            null,
            null,
            true
          )
        : await sendAlgoTransaction(
            session?.user.address!,
            STAKE_ADDRESS,
            asset_id,
            stakeAmount,
            JSON.stringify(note),
            signTransactions,
            null,
            false
          );

      if (sendResult.result != SEND_TXN_RESULT.OK) {
        let message = '';
        switch (sendResult.result) {
          case SEND_TXN_RESULT.INVALID_PARAM:
            {
              message = 'Invalid transaction parameters.';
            }
            break;
          case SEND_TXN_RESULT.NO_ASSET:
            {
              message = 'No asset is opted-in in your wallet';
            }
            break;
          case SEND_TXN_RESULT.INSUFFICIENT_AMOUNT:
            {
              message = 'Insufficient amount in your wallet';
            }
            break;
          case SEND_TXN_RESULT.INTERNAL_ERROR:
            {
              message = 'Error occured during sending transaction.';
            }
            break;
        }
        toast.error({ heading: 'Verification Error', message: message });
        setIsProcessing(false);
        return;
      }

      const txId = sendResult.txId!;
      const verifyResult = await confirmTransaction(
        session?.user.address!,
        txId
      );

      if (verifyResult != VERIFY_RESULT.OK) {
        toast.error({
          heading: 'Verification Error',
          message: `Confirm ${txId} failed`
        });
        setIsProcessing(false);
        return;
      }

      const dataResponse = await fetch('api/stake/verification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          miner_key: device.miner_key,
          address: session?.user.address,
          txId: txId,
          amount: stakeAmount,
          type: stakeType,
          asset_id: asset_id
        })
      });

      const dataResult = await dataResponse.json();
      if (!dataResponse.ok) {
        toast.error({
          heading: 'Verification Error',
          message: dataResult.message
        });
        setIsProcessing(false);
        return;
      }

      if (dataResult.success) {
        toast.success({
          heading: 'Verification Success',
          message: `Tx: ${txId}`
        });
      } else {
        toast.error({
          heading: 'Verification Error',
          message: 'Failed to verify'
        });
        setIsProcessing(false);
        return;
      }
    } catch (error) {
      console.error(error);
      toast.error({
        heading: 'Verification Error',
        message: 'Unknown error occured during staking'
      });
      setIsProcessing(false);
      return;
    }

    closeModal(modalName);
    handleStakingUpdate(device);
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
          <Title className="mb-5">{`Stake (${tokenName})`}</Title>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className="gap-3 w-full mt-5 text-slate-900"
          >
            <div className="flex gap-2">
              <p>BYOD:</p>
              <p>{device?.byod ? 'Yes' : 'No'}</p>
            </div>

            <div className="flex items-center space-x-2 gap-16">
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  name="stakeOption"
                  value="one"
                  checked={stakeType === 'one'}
                  onClick={() => setStateType('one')}
                  className="border border-red-600 text-red-600"
                />
                <span>24-Hour Staking(1.5x)</span>
              </label>
              <label className="flex items-center space-x-2">
                <input
                  type="radio"
                  name="stakeOption"
                  value="two"
                  checked={stakeType === 'two'}
                  onClick={() => setStateType('two')}
                  className="border border-red-600 text-red-600"
                />
                <span>6-months Staking(3x)</span>
              </label>
            </div>
            <div className="flex items-center w-full space-x-2">
              <label
                htmlFor="stakeAmount"
                className="text-sm font-medium text-gray-700 text-nowrap"
              >
                Amount to Stake:
              </label>
              <input
                id="stakeAmount"
                type="number"
                min="0"
                className="p-2 w-full border ml-2 text-black border-gray-500 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-red-600 disabled:opacity-50"
                defaultValue={0}
                disabled={true}
                value={stakeAmount}
              />
            </div>
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
              onClick={handleSubmit}
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
                'Stake'
              )}
            </Button>
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
};

export default StakeModal;
