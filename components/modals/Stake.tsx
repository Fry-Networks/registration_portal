import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { Device, FryToken } from '../../lib/types';
import { Product } from '../../pages/api/stake/verify-stake';
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
import { getTokenBalance } from '../../pages/api/stake/get-token-balance';
import { useSession } from 'next-auth/react';
import MessageUpdate from '../messageUpdate';
import { useWallet } from '@txnlab/use-wallet';

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
  const { activeAddress, signTransactions, sendTransactions } = useWallet();
  const { modals, openModal, closeModal } = useModal();
  const [stakeType, setStateType] = useState('one');
  const [tokenName, setTokenName] = useState('');
  const [stakeAmount, setStakeAmount] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [updateSuccess, setUpdateSuccess] = useState({
    status: 'success',
    message: ''
  });
  const { data: session } = useSession();

  console.log(product);

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

      console.log(noteInfo);
      const enc = new TextEncoder();
      const note = enc.encode(JSON.stringify(noteInfo));

      const transaction =
        algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from,
          to,
          amount: testMode ? 0 : amount * 1_000_000, // Amount in microAlgos
          note: note,
          assetIndex: Number(product.reward.tokens!.stake ?? 'none'),
          suggestedParams
        });

      const encodedTransaction = algosdk.encodeUnsignedTransaction(transaction);
      const signedTransactions = await signTransactions([encodedTransaction]);
      const waitRoundsToConfirm = 4;
      const { txId } = await sendTransactions(
        signedTransactions,
        waitRoundsToConfirm
      );

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
      let txId: any;
      if (devMode) {
        const account = algosdk.mnemonicToSecretKey(
          process.env.NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC!
        );

        const balanceResponse = await fetch('api/stake/get-token-balance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: account.addr,
            asset_id: product.reward.tokens!.stake
          })
        });

        if (!balanceResponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message: `Failed to get token balance from wallet. Check network status and try again`
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);
          setIsProcessing(false);
          return;
        }

        const balanceGet = await balanceResponse.json();
        if (balanceGet.success == false) {
          setUpdateSuccess({
            status: 'error',
            message: `There's no ${tokenName} token is in the wallet`
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);
          setIsProcessing(false);
          return;
        }

        const tokenAmountInWallet = balanceGet.balance;

        if (tokenAmountInWallet < stakeAmount) {
          setUpdateSuccess({
            status: 'error',
            message: `Insufficient amount in wallet. (${tokenAmountInWallet})`
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);
          setIsProcessing(false);
          return;
        }

        const stakeReponse = await fetch('api/stake/stake-dev', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            miner_key: device.miner_key,
            asset_id: product.reward.tokens!.stake,
            type: stakeType,
            from: session?.user.address,
            to: STAKE_ADDRESS,
            amount: stakeAmount
          })
        });

        if (!stakeReponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to send transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }

        const stakeResult = await stakeReponse.json();
        const txId = stakeResult.txId;
        console.log(txId);
        const verifyResponse = await fetch('api/stake/verify-stake', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            txId: txId,
            miner: device.miner_key,
            type: stakeType,
            asset_id: product.reward.tokens?.stake,
            address: session?.user.address
          })
        });

        if (!verifyResponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to verify transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }
      } else {
        if (!session || !session.user) {
          console.log('Unauthorized');
          return;
        }

        const balanceResponse = await fetch('api/stake/get-token-balance', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: session.user.address,
            asset_id: product.reward.tokens!.stake
          })
        });

        if (!balanceResponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message: `Failed to get token balance from wallet. Check network status and try again`
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);
          setIsProcessing(false);
          return;
        }

        const balanceGet = await balanceResponse.json();
        if (balanceGet.success == false) {
          setUpdateSuccess({
            status: 'error',
            message: `There's no ${tokenName} token is in the wallet`
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);
          setIsProcessing(false);
          return;
        }

        const tokenAmountInWallet = balanceGet.balance;

        if (tokenAmountInWallet === null) {
          setUpdateSuccess({
            status: 'error',
            message: `There's no ${tokenName} token is in the wallet`
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);
          setIsProcessing(false);
          return;
        }

        if (tokenAmountInWallet < stakeAmount) {
          setUpdateSuccess({
            status: 'error',
            message: `Insufficient amount in wallet. (${tokenAmountInWallet})`
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);
          setIsProcessing(false);
          return;
        }

        txId = await sendTransaction(
          activeAddress!,
          STAKE_ADDRESS,
          stakeAmount
        );

        if (!txId) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to send transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }

        console.log(txId);
        const verifyResponse = await fetch('api/stake/verify-stake', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            txId: txId,
            miner: device.miner_key,
            type: stakeType,
            address: session?.user.address
          })
        });

        if (!verifyResponse.ok) {
          setUpdateSuccess({
            status: 'error',
            message:
              'Failed to verify transaction. Please contact us before you try again'
          });
          setTimeout(() => {
            setUpdateSuccess({ status: 'error', message: '' });
          }, 5_000);

          setIsProcessing(false);
          return;
        }
      }
    } catch (error) {
      console.error(error);
      setUpdateSuccess({
        status: 'error',
        message: `Unknown error occured during staking`
      });
      setTimeout(() => {
        setUpdateSuccess({ status: 'error', message: '' });
      }, 5_000);
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
          <div className="px-2 sm:px-20">
            <MessageUpdate updateSuccess={updateSuccess} />
          </div>
          <Flex
            flexDirection="col"
            alignItems="stretch"
            justifyContent="center"
            className="gap-3 w-full mt-5"
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
                <span>24-Hour Staking</span>
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
                <span>6-months Staking</span>
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
