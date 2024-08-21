import {
    Button,
    Flex,
    Textarea,
    DatePicker,
    NumberInput,
    Callout,


} from '@tremor/react';
import { Key, useEffect, useState } from 'react';
import algosdk from 'algosdk'
import { Dialog, DialogPanel, Divider, TextInput } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useWallet } from '@txnlab/use-wallet';
import { set } from 'mongoose';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { useModal } from '../../app/modalcontext';
import { getFRYPrice } from '../../lib/price';

const algodClient = new algosdk.Algodv2(
    "",
    "https://mainnet-api.algonode.cloud",
    ""
);
const STAKE_ADDRESS = 'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';
const FRYIndex = 924268058;
export default function StakeVerification({ modalName, miner }: { modalName: string, miner?: string }) {
    const { modals, closeModal } = useModal();
    const { activeAddress, signTransactions, sendTransactions } = useWallet()
    const [updateSuccess, setUpdateSuccess] = useState("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [paid, setPaid] = useState<boolean>(false);
    const [FRYamount, setFRYAmount] = useState<{stake_one: number, stake_two: number}>({stake_one: 0, stake_two: 0});
    const { activeAccount } = useWallet();
    useEffect(() => {
        const fetchMinerTypes = async () => {
            const response = await fetch('/api/stake-amount', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ address: activeAccount?.address, key: miner!.split('-')[0] }),
            });
            if (response.ok) {
                const data = await response.json();
                setFRYAmount(data.data.stake);
            }
        };
        if (miner) {
            fetchMinerTypes();
        }


    }, [miner]);

    const sendTransaction = async (from?: string, to?: string, amount?: number) => {
        try {
            if (!from || !to || !amount) {
                throw new Error('Missing transaction params.')
            }

            const suggestedParams = await algodClient.getTransactionParams().do()
            const transaction = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
                from,
                to,
                amount: amount * 1_000_000,
                note: new Uint8Array(Buffer.from("Verification stake")),
                assetIndex: FRYIndex,
                suggestedParams
            })

            const encodedTransaction = algosdk.encodeUnsignedTransaction(transaction)
            const signedTransactions = await signTransactions([encodedTransaction])
            const waitRoundsToConfirm = 4
            let { id } = await sendTransactions(signedTransactions, waitRoundsToConfirm)
            console.log('Successfully sent transaction. Transaction ID: ', id)
            return id

        } catch (error) {
            console.error(error)
        }
    }

    const handleStake = async (type: "one" | "two") => {
        setIsLoading(true);
        const FRYPrice = await getFRYPrice();
        if (!FRYPrice || !miner || !activeAddress) {
            setUpdateSuccess('error')
            setIsLoading(false);
            return;
        }
        const txId = await sendTransaction(activeAddress, STAKE_ADDRESS, FRYamount[`stake_${type}`]);
        console.log(txId)
        if (txId) {
            setUpdateSuccess('Successfully sent transaction. Your miner will be verified soon.')
            setTimeout(() => setUpdateSuccess(""), 15_000);
            const response = await fetch('/api/verify-stake', { // Replace with your actual API endpoint
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ txId, address: activeAddress, miner: miner, type }),
            });

            if (!response.ok) {
                setUpdateSuccess("error"); // Reset success state
                setTimeout(() => setUpdateSuccess(""), 30_000);
                setIsLoading(false);
            } else {
                setUpdateSuccess('Your miner has been verified.')
                setIsLoading(false);
                setPaid(true);
                setTimeout(() => setUpdateSuccess(""), 15_000);
            }
        } else {
            setUpdateSuccess('error')
            setIsLoading(false);
        }

    }

    return (<Dialog
        open={modals[modalName]}
        onClose={() => closeModal(modalName)}
        static={true}
        className="z-[100]"
    >
        <DialogPanel className="max-w-xl">
            <div className="absolute right-0 top-0 pr-3 pt-3">
                <button
                    type="button"
                    className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
                    onClick={() => closeModal(modalName)}
                    aria-label="Close"
                >
                    <RiCloseLine
                        className="h-5 w-5 shrink-0"
                        aria-hidden={true}
                    />
                </button>
            </div>
            {(updateSuccess != "" && updateSuccess != "error") && (
                <Callout className="mt-4 mb-4" title="Success" icon={CheckCircleIcon} color="teal">
                    {updateSuccess}
                </Callout>
            )}
            {(updateSuccess == "error") && (
                <Callout className="mt-4 mb-4" title="Error" icon={CheckCircleIcon} color="red">
                    Error sending transaction. Please contact us before trying again !!
                </Callout>
            )}
            <form action="#" method="POST">
                <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    Stake for verification
                </h4>
                <p className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                    All $FRY sent will be locked for 24h OR 6 months before you can withdraw them again.
                </p>

                <Button
                    className="mt-4"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleStake("one");
                    }}
                    disabled={isLoading || paid || FRYamount.stake_one == 0} // Disable button while loading
                >
                    {isLoading ? 'Processing...' : `Stake (${FRYamount.stake_one} $FRY) 24h Lock`}
                </Button>
                <Button
                    className="mt-4 ml-4"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleStake("two");
                    }}
                    disabled={isLoading || paid || FRYamount.stake_one == 0} // Disable button while loading
                >
                    {isLoading ? 'Processing...' : `Stake (${FRYamount.stake_two} $FRY) 6 months Lock}`}
                </Button>

            </form>
        </DialogPanel>
    </Dialog>
    );
}