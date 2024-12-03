import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { Device } from '../../lib/types';
import { Product } from '../../pages/api/stake/verify-stake';
import { useModal } from '../../app/modalcontext';
import { useEffect, useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { useSession } from 'next-auth/react';
import MessageUpdate from '../MessageUpdate';
import axios from 'axios';
import { getTokenBalance } from '../../pages/api/stake/get-token-balance';

const fry2AssetId = '2485314946';
const USDAmount = process.env.NODE_ENV === 'production' ? 50 : 0.003;
const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';
const fryAlgo = 'ATPVJYGEGP5H6GCZ4T6CG4PK7LH5OMWXHLXZHDPGO7RO6T3EHWTF6UUY6E';
import algosdk from 'algosdk';
import { useWallet } from '@txnlab/use-wallet';
import { getFRYPrice } from '../../lib/price';
const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = '';

export default function WithdrawModal({
  modalName,
  device,
  product,
  handleWithdrawUpdate
}: {
  modalName: string;
  device: Device;
  product: Product;
  handleWithdrawUpdate: (device: Device) => void;
}) {
  const { activeAddress, signTransactions, sendTransactions } = useWallet();
  const { modals, closeModal } = useModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isWithdrawable, setIsWithdrawable] = useState(false);
  const [withdrawableTime, setWithdrawableTime] = useState<Date>(
    new Date(Date.now())
  );
  const [updateSuccess, setUpdateSuccess] = useState({
    status: 'success',
    message: ''
  });
  const { data: session } = useSession();

  const fetchWithdrawable = async (device: Device) => {
    console.log('fetchWithdrawable');
    if (!session || !session.user) {
      console.log('Session invalid');
      return;
    }

    try {
      const response = await fetch('api/stake/withdrawable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          miner_key: device.miner_key,
          address: session.user.address
        })
      });

      if (!response.ok) {
        setUpdateSuccess({
          status: 'error',
          message: 'Network error to get withdraw status'
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        }, 3_000);

        return;
      }

      const result = await response.json();
      console.log(result);
      setIsWithdrawable(result.data.available);
      setWithdrawableTime(new Date(result.data.availableIn));
    } catch (error) {}
  };

  useEffect(() => {
    fetchWithdrawable(device);
  }, [device, product, modals]);

  const sendTransaction = async (from: string, to: string, amount: number) => {
    try {
      const algodClient = new algosdk.Algodv2(tokenToSend, server, port);
      const suggestedParams = await algodClient.getTransactionParams().do();
      const noteInfo = {
        miner_key:
          device.miner_key.split('-')[0] +
          '-' +
          device.miner_key.split('-')[1].slice(0, 6),
        asset_id: product.reward.tokens!.stake,
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
          amount: amount * 1_000_000, // Amount in microAlgos
          note: note,
          assetIndex: Number(product.reward.tokens!.stake),
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

  const handleBoostWithdraw = async () => {
    // setIsProcessing(true);
    // try {
    //   const tokenPrice = await getFRYPrice(
    //     device.staked?.asset_id ?? fry2AssetId
    //   );
    //   console.log(`TokenPrice: ${tokenPrice}`);
    //   const amount = Math.floor(USDAmount / tokenPrice);
    //   console.log(`Fee pay amount: ${amount}`);
    //   const balanceResponse = await fetch('api/stake/get-token-balance', {
    //     method: 'POST',
    //     headers: {
    //       'Content-Type': 'application/json'
    //     },
    //     body: JSON.stringify({
    //       address: account.addr,
    //       asset_id: product.reward.tokens!.stake
    //     })
    //   });
    //   if (!balanceResponse.ok) {
    //     setUpdateSuccess({
    //       status: 'error',
    //       message: `Failed to get token balance from wallet. Check network status and try again`
    //     });
    //     setTimeout(() => {
    //       setUpdateSuccess({ status: 'error', message: '' });
    //     }, 3_000);
    //     setIsProcessing(false);
    //     return;
    //   }
    //   const balanceGet = await balanceResponse.json();
    //   if (balanceGet.success == false) {
    //     setUpdateSuccess({
    //       status: 'error',
    //       message: `There's no ${tokenName} token is in the wallet`
    //     });
    //     setTimeout(() => {
    //       setUpdateSuccess({ status: 'error', message: '' });
    //     }, 3_000);
    //     setIsProcessing(false);
    //     return;
    //   }
    //   const tokenAmountInWallet = balanceGet.balance;
    //   if (!tokenAmountInWallet || tokenAmountInWallet < amount) {
    //     setUpdateSuccess({
    //       status: 'error',
    //       message: 'Not enough token amount is in the wallet'
    //     });
    //     setTimeout(() => {
    //       setUpdateSuccess({ status: 'error', message: '' });
    //     });
    //     setIsProcessing(false);
    //     return;
    //   }
    //   if (devMode) {
    //     const payResponse = await fetch('api/fee/pay-withdraw', {
    //       method: 'POST',
    //       headers: {
    //         'Content-Type': 'application/json'
    //       },
    //       body: JSON.stringify({
    //         miner_key: device.miner_key,
    //         asset_id: device.staked?.asset_id ?? fry2AssetId,
    //         from: session?.user.address,
    //         to: fryAlgo,
    //         amount: amount
    //       })
    //     });
    //     if (!payResponse.ok) {
    //       setUpdateSuccess({
    //         status: 'error',
    //         message:
    //           'Failed in pay fee for boosting withdraw. Please contact us before you try again'
    //       });
    //       setTimeout(() => {
    //         setUpdateSuccess({ status: 'error', message: '' });
    //       });
    //       setIsProcessing(false);
    //       return;
    //     }
    //     const payResult = await payResponse.json();
    //     const verifyResponse = await fetch('api/fee/verify-pay', {
    //       method: 'POST',
    //       headers: {
    //         'Content-Type': 'application/json'
    //       },
    //       body: JSON.stringify({
    //         miner_key: device.miner_key,
    //         txId: payResult.txId,
    //         address: session?.user.address
    //       })
    //     });
    //     if (!verifyResponse.ok) {
    //       setUpdateSuccess({
    //         status: 'error',
    //         message:
    //           'Failed to verify pay fee for boosting withdraw. Please contact us before you try again'
    //       });
    //       setTimeout(() => {
    //         setUpdateSuccess({ status: 'error', message: '' });
    //       });
    //       setIsProcessing(false);
    //       return;
    //     }
    //     await handleWithdraw();
    //   } else {
    //     if (!session || !session.user) {
    //       console.log('Unauthorized');
    //       return;
    //     }
    //     const txId = await sendTransaction(activeAddress!, fryAlgo, amount);
    //     if (!txId) {
    //       setUpdateSuccess({
    //         status: 'error',
    //         message:
    //           'Failed in pay fee for boosting withdraw. Please contact us before you try again'
    //       });
    //       setTimeout(() => {
    //         setUpdateSuccess({ status: 'error', message: '' });
    //       });
    //       setIsProcessing(false);
    //       return;
    //     }
    //     const verifyResponse = await fetch('api/fee/verify-pay', {
    //       method: 'POST',
    //       headers: {
    //         'Content-Type': 'application/json'
    //       },
    //       body: JSON.stringify({
    //         miner_key: device.miner_key,
    //         txId: txId,
    //         address: session?.user.address
    //       })
    //     });
    //     if (!verifyResponse.ok) {
    //       setUpdateSuccess({
    //         status: 'error',
    //         message:
    //           'Failed to verify pay fee for boosting withdraw. Please contact us before you try again'
    //       });
    //       setTimeout(() => {
    //         setUpdateSuccess({ status: 'error', message: '' });
    //       });
    //       setIsProcessing(false);
    //       return;
    //     }
    //     await handleWithdraw();
    //   }
    // } catch (error) {
    //   setUpdateSuccess({
    //     status: 'error',
    //     message:
    //       'Failed in pay fee for boosting withdraw. Please contact us before you try again'
    //   });
    //   setTimeout(() => {
    //     setUpdateSuccess({ status: 'error', message: '' });
    //   });
    //   setIsProcessing(false);
    // }
  };

  const handleWithdraw = async () => {
    setIsProcessing(true);
    try {
      const response = await fetch('/api/stake/stake-withdraw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: session?.user.address,
          miner_key: device.miner_key
        })
      });

      if (!response.ok) {
        setUpdateSuccess({
          status: 'error',
          message:
            'Failed to withdraw the token. Please contact us before you try again'
        });
        setTimeout(() => {
          setUpdateSuccess({ status: 'error', message: '' });
        });

        setIsProcessing(false);
        return;
      }

      setIsProcessing(false);
      closeModal(modalName);
      handleWithdrawUpdate(device);
    } catch (error) {
      console.error(error);
      setUpdateSuccess({
        status: 'error',
        message:
          'Failed to withdraw the token. Please contact us before you try again'
      });
      setTimeout(() => {
        setUpdateSuccess({ status: 'error', message: '' });
      });

      setIsProcessing(false);
      return;
    }
  };

  return (
    <div>
      <Dialog
        open={modals[modalName]}
        onClose={() => {}}
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
          <Title className="mb-5">{`Withdraw`}</Title>
          <div className="px-2 sm:px-20">
            <MessageUpdate updateSuccess={updateSuccess} />
          </div>
          <p>
            {isWithdrawable
              ? `You can withdraw now`
              : `You can withdraw at ${withdrawableTime}`}
          </p>

          {!isWithdrawable && (
            <p className="text-red-500 mt-4">
              Note: You can click 'Withdarw with Boost' button to pay 50USD to
              withdraw the token immediately.
            </p>
          )}
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
              disabled={!isWithdrawable}
              onClick={() => handleWithdraw()}
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
                'Withdarw'
              )}
            </Button>
            {/* <Button
              className={`relative flex items-center justify-center bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 ${
                isProcessing ? 'cursor-not-allowed' : 'cursor-default'
              }`}
              onClick={() => handleBoostWithdraw()}
              disabled={isWithdrawable}
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
                'Withdarw with Boost'
              )}
            </Button> */}
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
