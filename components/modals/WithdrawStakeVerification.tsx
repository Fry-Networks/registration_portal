import {
    Button,
    Flex,
    Textarea,
    DatePicker,
    NumberInput,
    Callout,


} from '@tremor/react';
import { useEffect, useState } from 'react';
import algosdk from 'algosdk'
import { Dialog, DialogPanel } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useWallet } from '@txnlab/use-wallet';
import { CheckCircleIcon } from '@heroicons/react/24/outline';
import { useModal } from '../../app/modalcontext';

const algodClient = new algosdk.Algodv2(
    "",
    "https://mainnet-api.algonode.cloud",
    ""
);
const STAKE_ADDRESS = 'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';
const FRYIndex = 924268058;
export default function WithdrawStakeVerification({ modalName, miner, staked }: { modalName: string, miner?: string, staked?: number }) {
    const { modals, closeModal } = useModal();
    const { activeAddress } = useWallet()
    const [updateSuccess, setUpdateSuccess] = useState("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [disabled, setDisabled] = useState<boolean>(false);
    const [available, setAvailable] = useState<{ available: boolean, availableIn: number }>({ available: false, availableIn: 0 });
    const { activeAccount } = useWallet();
    useEffect(() => {
        const fetchAvailable = async () => {
            const response = await fetch('/api/stake-available', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ address: activeAccount?.address, miner_key: miner }),
            });
            if (response.ok) {
                const data = await response.json();
                setAvailable(data.data);
            }
        };
        if (miner) {
            fetchAvailable();
        }


    }, [miner]);

    const handleWithdrawal = async () => {
        setIsLoading(true);
        const response = await fetch('/api/stake-withdraw', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ address: activeAccount?.address, miner_key: miner }),
        });
        if (response.ok) {
            const data = await response.json();
            setIsLoading(false);
            setUpdateSuccess("Your stake has been withdrawn successfully");
            setDisabled(true);

        } else {
            setUpdateSuccess("error");

        }
    };

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
                    Withdraw your verification stake ({staked} $FRY)
                </h4>
                <p className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                    Withdrawing your stake will remove your miner from the verification list. You will need to stake again to verify your miner.
                </p>

                <Button
                    className="mt-4"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleWithdrawal();
                    }}
                    disabled={isLoading || !available.available || disabled} // Disable button while loading
                >

                    {available.availableIn > 0 ? `Available in ${(available.availableIn * 24) > 24 ? `${(available.availableIn * 24 / 24).toFixed(0)} days` : `${(available.availableIn * 24).toFixed(0)} hours`}` :
                        isLoading ?
                            'Processing...' :
                            'Withdraw'}
                </Button>
            </form>
        </DialogPanel>
    </Dialog>
    );
}