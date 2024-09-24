import {
    Button,
    Flex,
    Textarea,
    DatePicker,
    NumberInput,
    Callout,
    Dialog,
    DialogPanel,
    Divider,
    TextInput
} from '@tremor/react';
import { useEffect, useState } from 'react';
import algosdk from 'algosdk';
import { RiCloseLine } from '@remixicon/react';
import { useWallet } from '@txnlab/use-wallet';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { useModal } from '../../app/modalcontext';
import { getFRYPrice } from '../../lib/price';
import { useRouter } from 'next/router';

const algodClient = new algosdk.Algodv2(
    "",
    "https://mainnet-api.algonode.cloud",
    ""
);
const STAKE_ADDRESS = 'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';
const FRYIndex = 924268058;

export default function StakeVerification({ modalName, miner, byod }: { modalName: string, miner?: string, byod: boolean }) {
    const router = useRouter();
    const { modals, closeModal } = useModal();
    const { activeAddress, signTransactions, sendTransactions } = useWallet();
    const [updateSuccess, setUpdateSuccess] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [paid, setPaid] = useState<boolean>(false);
    const [FRYamount, setFRYAmount] = useState<{ stake_one: number, stake_two: number }>({ stake_one: 0, stake_two: 0 });

    useEffect(() => {
        const fetchMinerTypes = async () => {
            try {
                if (!miner || !activeAddress) return;
    
                const response = await fetch('/api/stake-amount', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ address: activeAddress, key: miner.split('-')[0] }),
                });
    
                if (!response.ok) {
                    throw new Error('Failed to fetch stake amounts');
                }
    
                const data = await response.json();
                let stake_data = data.data.stake as { stake_one: number, stake_two: number };
    
                if (byod) {
                    stake_data = {
                        stake_one: stake_data.stake_one / 2,
                        stake_two: stake_data.stake_two / 2,
                    };
                }
    
                setFRYAmount(stake_data);
            } catch (error) {
                console.error("Error fetching miner types:", error);
                setUpdateSuccess('error');
            }
        };
    
        fetchMinerTypes();
    }, [miner, activeAddress, byod]);
    

    const sendTransaction = async (from: string, to: string, amount: number) => {
        try {
            const suggestedParams = await algodClient.getTransactionParams().do();
            const transaction = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
                from,
                to,
                amount: amount * 1_000_000, // Amount in microAlgos
                note: new Uint8Array(Buffer.from("Verification stake" + (Math.floor(Math.random() * 1000)))),
                assetIndex: FRYIndex,
                suggestedParams,
            });

            const encodedTransaction = algosdk.encodeUnsignedTransaction(transaction);
            const signedTransactions = await signTransactions([encodedTransaction]);
            const waitRoundsToConfirm = 4;
            const { txId } = await sendTransactions(signedTransactions, waitRoundsToConfirm);

            console.log('Successfully sent transaction. Transaction ID:', txId);
            return txId;
        } catch (error) {
            console.error("Transaction failed:", error);
            return null;
        }
    };

    const handleStake = async (type: "one" | "two") => {
        setIsLoading(true);

        try {
            const FRYPrice = await getFRYPrice();

            if (!FRYPrice || !miner || !activeAddress) {
                setUpdateSuccess('error');
                setIsLoading(false);
                return;
            }

            const amountToStake = FRYamount[`stake_${type}`];
            const txId = await sendTransaction(activeAddress, STAKE_ADDRESS, amountToStake);

            if (txId) {
                setUpdateSuccess('Successfully sent transaction. Your miner will be verified soon.');
                setTimeout(() => setUpdateSuccess(""), 15000);

                const response = await fetch('/api/verify-stake', {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ txId, address: activeAddress, miner, type }),
                });

                if (response.ok) {
                    setUpdateSuccess('Your miner has been verified.');
                    setPaid(true);
                    router.reload();
                } else {
                    setUpdateSuccess("error");
                }
            } else {
                setUpdateSuccess('error');
            }
        } catch (error) {
            console.error("Stake failed:", error);
            setUpdateSuccess('error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog
            open={modals[modalName]}
            onClose={() => closeModal(modalName)}
            static={true}
            className="z-[100]"
            >
            <DialogPanel className="max-w-xl w-full mx-auto p-4 md:p-6 relative bg-white dark:bg-dark-tremor-background rounded-lg shadow-lg">
                <div className="absolute right-0 top-0 pr-3 pt-3">
                <button
                    type="button"
                    className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
                    onClick={() => closeModal(modalName)}
                    aria-label="Close"
                >
                    <RiCloseLine className="h-5 w-5" aria-hidden={true} />
                </button>
                </div>

                {updateSuccess && updateSuccess !== "error" && (
                <Callout className="mt-4 mb-4" title="Success" icon={CheckCircleIcon} color="teal">
                    {updateSuccess}
                </Callout>
                )}

                {updateSuccess === "error" && (
                <Callout className="mt-4 mb-4" title="Error" icon={CheckCircleIcon} color="red">
                    Error sending transaction. Please contact us before trying again!
                </Callout>
                )}

                <form>
                <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    Stake for verification
                </h4>
                <p className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                    All $FRY sent will be locked for 24h OR 6 months before you can withdraw them again.
                </p>

                <div className="flex flex-col md:flex-row gap-4 mt-4">
                    <Button
                    className="w-full md:w-auto"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleStake("one");
                    }}
                    disabled={isLoading || paid || FRYamount.stake_one === 0}
                    >
                    {isLoading ? 'Processing...' : `Stake (${FRYamount.stake_one} $FRY) 24h Lock`}
                    </Button>

                    <Button
                    className="w-full md:w-auto"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleStake("two");
                    }}
                    disabled={isLoading || paid || FRYamount.stake_two === 0}
                    >
                    {isLoading ? 'Processing...' : `Stake (${FRYamount.stake_two} $FRY) 6 months Lock`}
                    </Button>
                </div>
                </form>
            </DialogPanel>
        </Dialog>
    );
}
