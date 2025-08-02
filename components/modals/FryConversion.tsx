import { useEffect, useState } from 'react';
import algosdk from 'algosdk';
import {
  Button,
  Dialog,
  DialogPanel,
  Flex,
  Title,
  Select,
  SelectItem
} from '@tremor/react';
import { FryConversion } from '../../lib/types';
import { useModal } from '../../app/modalcontext';
import { RiCloseLine } from '@remixicon/react';
import { useSession } from 'next-auth/react';
import { useWallet } from '@txnlab/use-wallet';
import { useToastContext } from '../../hooks/ToastContext';
import {
  algodClient,
  BURN_WALLET,
  FRY_1,
  FRY_2,
  CORE_RELEASE_DATE,
  ALL_RELEASE_DATE,
  MODS_RELEASE_DATE
} from '../../lib/utils';
import ProgressMonthBar from '../ProgressMonthBar';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export default function FryConversionModal({
  modalName,
  address,
  onClose
}: {
  modalName: string;
  address: string | undefined;
  onClose: () => void;
}) {
  const { activeAddress, signTransactions, sendTransactions } = useWallet();
  const { modals, closeModal } = useModal();
  const [account, setAccount] = useState<FryConversion | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isConverted, setIsConverted] = useState(false);
  const [selectedTokenType, setSelectedTokenType] = useState('2485314946');

  const { data: session } = useSession();
  const toast = useToastContext();

  const transferToBurn = async (
    from: string | undefined,
    amount: number
  ): Promise<string | null> => {
    try {
      if (from === undefined) return null;

      const suggestedParams = await algodClient.getTransactionParams().do();
      const to = BURN_WALLET;

      const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: from.toString(),
        to: to.toString(),
        amount: testMode
          ? 0
          : BigInt(Math.floor(amount * Math.pow(10, FRY_1.decimals || 0))), // Amount in microAlgos
        assetIndex: Number(FRY_1.id),
        suggestedParams: suggestedParams
      });

      const encodedTxn = algosdk.encodeUnsignedTransaction(txn);
      const signedTransactions = await signTransactions([encodedTxn]);
      const waitRoundsToConfirm = 4;

      const { id, txId } = await sendTransactions(
        signedTransactions,
        waitRoundsToConfirm
      );

      console.log('Burn Transfer TxId: ', txId, id);

      if (txId) {
        return txId;
      }
      return null;
    } catch (error) {
      console.error('Burn Transfer Error: ', error);
      return null;
    }
  };

  // Remove fetchConversionStatus and related logic from here. Instead, expect a prop like `availabilityChecked` and `csvData` to be passed in, and only show conversion UI if availabilityChecked is true. The modal should not fetch or check availability itself anymore.
  const fetchConversionStatus = async () => {
    if (modals[modalName] === false) {
      return;
    }

    if (!session || !session.user) {
      console.log('Session invalid');
      return;
    }

    try {
      const response = await fetch('api/conversion/get_fry_conversion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          address: session.user.address,
          convertType: selectedTokenType
        })
      });

      if (!response.ok) {
        toast.error({
          heading: 'Error',
          message: 'Network error to get account status for conversion'
        });
        return;
      }

      const result = await response.json();
      setIsConverted(result.user.status === 'pending' ? true : false);
      setAccount(result.user);
    } catch (error) {}
  };

  useEffect(() => {
    // This useEffect is no longer needed as availability is passed as a prop.
    // Keeping it for now, but it will be removed if not used elsewhere.
    fetchConversionStatus();
  }, [address, modals, selectedTokenType]);

  const handleConvert = async () => {
    setIsProcessing(true);

    if (isConverted) {
      try {
        const response = await fetch('api/conversion/transfer_reward', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: address,
            convertType: selectedTokenType
          })
        });

        if (!response.ok) {
          const failure = await response.json();
          toast.error({
            heading: 'Claim Error',
            message: failure.message
          });

          setIsProcessing(false);
          return;
        }

        const result = await response.json();
        if (result.success)
          toast.success({
            heading: 'Claim Successful',
            message: `${result.message}`
          });
        else {
          toast.error({
            heading: 'Claim Error',
            message: `${result.message}`
          });
        }

        setIsProcessing(false);
        closeModal(modalName);
        return;
      } catch (error) {
        console.error(error);

        toast.error({
          heading: 'Claim Error',
          message:
            'Failed to try the claim. Please contact us before you try again'
        });
        setIsProcessing(false);
        return;
      }
    } else {
      try {
        if (account) {
          const t = await transferToBurn(address, account.amount);
          if (t) {
            const response = await fetch('/api/conversion/set_fry_conversion', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                address: session?.user.address,
                id: t
              })
            });

            if (!response.ok) {
              const failure = await response.json();
              toast.error({
                heading: 'Conversion Error',
                message: failure.message
              });

              setIsProcessing(false);
              return;
            }

            const result = await response.json();
            if (result.success) {
              toast.success({
                heading: 'Conversion Successful',
                message: `${result.message}`
              });
            } else {
              toast.error({
                heading: 'Conversion Error',
                message: `${result.message}`
              });
            }
          } else {
            toast.error({
              heading: 'Conversion Error',
              message:
                'Failed to transfer the fry1.0 to Burn Account. Please contact us before you try again'
            });
          }
        }

        setIsProcessing(false);
        closeModal(modalName);
        return;
      } catch (error) {
        console.error(error);

        toast.error({
          heading: 'Conversion Error',
          message:
            'Failed to set the convert. Please contact us before you try again'
        });
        setIsProcessing(false);
        return;
      }
    }
  };

  // Add logic to check if conversion is still allowed
  const isConversionOpen = () => {
    const now = new Date();
    const start = account?.ratio ? (account.ratio[2] === 1 ? CORE_RELEASE_DATE : MODS_RELEASE_DATE) : ALL_RELEASE_DATE;
    const diff = now.getTime() - start.getTime();
    const monthsSinceRelease = diff / (1000 * 60 * 60 * 24 * 30);
    return monthsSinceRelease > 0 && monthsSinceRelease <= 13;
  };

  return (
    <div>
      <Dialog
        open={modals[modalName]}
        onClose={onClose}
        static={true}
        className="z-[100]"
      >
        <DialogPanel className="max-w-xs sm:max-w-3xl">
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
          <Title className="mb-5">{isConverted ? 'Conversion' : 'Conversion Preview'}</Title>
          <Flex flexDirection="row" justifyContent="start" alignItems="end">
            <p className="text-slate-900 hidden sm:block">
              <strong>{`Conversion Type: `}</strong>
            </p>
            <p className="text-slate-900 block sm:hidden mr-4">
              <strong>{`Type: `}</strong>
            </p>
            <Select
              value={selectedTokenType}
              onValueChange={(val) => setSelectedTokenType(val)}
              className="ml-1 mb-1 max-w-4"
              // disabled={isConverted ? true : false}
            >
              <SelectItem value="2485314946">FRY 2.0</SelectItem>
              <SelectItem value="2485202024">fNODE</SelectItem>
            </Select>
          </Flex>
          <p className="text-slate-900 hidden sm:block">
            <strong>{'Wallet address: '}</strong>
            {`${account?.address.slice(0, 12)} ... ${account?.address.slice(-12)}`}
          </p>
          <p className="text-slate-900 block sm:hidden">
            <strong>{'Address: '}</strong>
            {`${account?.address.slice(0, 6)} ... ${account?.address.slice(-6)}`}
          </p>
          <p className="text-slate-900">
            <strong>{`FRY1.0 Amount: `}</strong>
            {account?.amount}
          </p>
          {account && account.status === 'valid' && (
            <p className="text-slate-900">
              <strong>{`${selectedTokenType === FRY_2.id ? 'FRY2.0' : 'fNODE'} Amount After Conversion: `}</strong>
              {(selectedTokenType === FRY_2.id
                    ? account.amount /
                      (account?.ratio ? account.ratio[0] : 80)
                    : account.amount /
                      (account?.ratio ? account.ratio[1] : 40)
                  ).toFixed(5)}
            </p>
          )}

          {account && account.status === 'pending' && (
            <>
              <Flex
                flexDirection="col"
                alignItems="start"
                className="mt-3 w-full sm:auto"
              >
                <p className="text-slate-900">
                  <strong>Remaining Converted Amount: </strong>
                  {(selectedTokenType === FRY_2.id
                    ? (account.pendingAmount /
                      (account?.ratio ? account.ratio[0] : 80)).toFixed(5) + ' FRY2.0'
                    : (account.pendingAmount /
                      (account?.ratio ? account.ratio[1] : 40)).toFixed(5) + ' fNODE'
                  )} 
                </p>
                <p className="text-slate-900">
                  <strong>Claimable Amount: </strong>
                  {/* {account.claimableAmount.toFixed(5)} */}
                  {(selectedTokenType === FRY_2.id
                    ? ((account.amount /
                        (account?.ratio ? account.ratio[0] * 12 : 960)) *
                      account.claimableMonths).toFixed(5) + ' FRY2.0'
                    : ((account.amount /
                        (account?.ratio ? account.ratio[1] * 12 : 480)) *
                      account.claimableMonths).toFixed(5) + ' fNODE'
                  )}
                </p>
              </Flex>
              <ProgressMonthBar specificDate={account?.ratio ? (account.ratio[2] === 1 ? CORE_RELEASE_DATE : MODS_RELEASE_DATE) : ALL_RELEASE_DATE} pA={account.pendingAmount}/>
            </>
          )}

          {/* Claim History Table */}
          {account?.history && account.history.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-2">Claim History</h3>
              <table className="min-w-full text-sm border border-slate-300 rounded">
                <thead>
                  <tr>
                    <th className="px-2 py-1 border-b text-center">Amount</th>
                    <th className="px-2 py-1 border-b text-center">
                      Token Type
                    </th>
                    <th className="px-2 py-1 border-b text-center">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {account.history.map((item, idx) => (
                    <tr key={idx}>
                      <td className="px-2 py-1 text-center">
                        {item.amount.toFixed(5)}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {item.tokenType}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {new Date(item.date).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Flex
            flexDirection="row"
            justifyContent="center"
            className="gap-3 w-full mt-5"
          >
            <Button
              className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
              onClick={() => !isProcessing && onClose()}
            >
              Close
            </Button>
            {isConversionOpen() && (
              <Button
                className={`relative flex items-center justify-center bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 ${
                  isProcessing ? 'cursor-not-allowed' : 'cursor-default'
                }`}
                disabled={
                  isConverted === false
                    ? account && account?.amount > 0
                      ? false
                      : true
                    : account && account?.claimableAmount > 0
                      ? false
                      : true
                }
                onClick={() => handleConvert()}
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
                  `${isConverted ? 'Claim' : 'Convert'}`
                )}
              </Button>
            )}
          </Flex>
        </DialogPanel>
      </Dialog>
    </div>
  );
}
