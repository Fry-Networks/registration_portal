import {
    Button,
    Flex,
    Textarea,
    DatePicker,
    NumberInput,
    Callout,


} from '@tremor/react';
import { Key, useState } from 'react';
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
const BURN_ADDRESS = 'MO3FUXGKGZRTVYOSCXR3FXMPZQCZHR2BGGT2B5SINVBA3W6YCZNO25GGLM';
const FRYIndex = 924268058;
const USDamount = 50;
export default function VerificationBurn({ modalName, miner }: { modalName: string, miner?: string }) {
    const { modals, closeModal } = useModal();
    const { activeAddress, signTransactions, sendTransactions } = useWallet()
    const [updateSuccess, setUpdateSuccess] = useState("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [paid, setPaid] = useState<boolean>(false);


    const sendTransaction = async (from?: string, to?: string, amount?: number) => {
        try {
            if (!from || !to || !amount) {
                throw new Error('Missing transaction params.')
            }

            const suggestedParams = await algodClient.getTransactionParams().do()
            const transaction = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
                from,
                to,
                amount,
                note: new Uint8Array(Buffer.from("Verification burn")),
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

    const handleBurn = async () => {
        setIsLoading(true);
        const FRYPrice = await getFRYPrice();
        if (!FRYPrice || !miner || !activeAddress) {
            setUpdateSuccess('error')
            setIsLoading(false);
            return;
        }
        const value = Math.floor((USDamount / FRYPrice)) * (process.env.NODE_ENV === 'development' ? 1 : 1000000)
        console.log(value)
        const txId = await sendTransaction(activeAddress, BURN_ADDRESS, value);
        console.log(txId)
        if (txId) {
            setUpdateSuccess('Successfully sent transaction. Your miner will be verified soon.')
            setTimeout(() => setUpdateSuccess(""), 15_000);
            const response = await fetch('/api/verify-burn', { // Replace with your actual API endpoint
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ txId, address: activeAddress, miner: miner }),
            });

            if (!response.ok) {
                setUpdateSuccess("error"); // Reset success state
                setTimeout(() => setUpdateSuccess(""), 30_000);
                throw new Error(`HTTP error! Status: ${response.status}`);
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
                    Pay for verification (50$ worth of $FRY)
                </h4>
                <p className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                    All $FRY sent will be burnt
                </p>

                <Button
                    className="mt-4"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleBurn();
                    }}
                    disabled={isLoading || paid} // Disable button while loading
                >
                    {isLoading ? 'Processing...' : 'Pay (will initiate a transaction)'} 
                </Button>
            </form>
        </DialogPanel>
    </Dialog>
    );
}