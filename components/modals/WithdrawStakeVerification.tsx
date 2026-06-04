import { useEffect, useState } from 'react';
import { Dialog, DialogPanel, Button, Callout } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { CheckCircleIcon } from '@heroicons/react/outline';
import { useModal } from '../../app/modalcontext';
import { useWallet } from '@txnlab/use-wallet-react';
import { useRouter } from 'next/router';
import { secureFetch } from '../../lib/api/secureFetch';

interface WithdrawStakeProps {
    modalName: string;
    miner?: string;
    staked?: number;
}

export default function WithdrawStakeVerification({ modalName, miner, staked }: WithdrawStakeProps) {
    const router = useRouter();
    const { modals, closeModal } = useModal();
    const { activeAccount } = useWallet();
    const [updateSuccess, setUpdateSuccess] = useState<string>('');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [disabled, setDisabled] = useState<boolean>(false);
    const [available, setAvailable] = useState<{ available: boolean; availableIn: number; legacy?: boolean }>({
        available: false,
        availableIn: 0,
        legacy: false,
    });
    const isLegacyUnlock = available.legacy === true;
    const [acknowledged, setAcknowledged] = useState(false);

    // Fetch availability for withdrawal
    useEffect(() => {
        const fetchAvailable = async () => {
            try {
        const response = await secureFetch('/api/stake/withdrawable', {
                    address: activeAccount?.address,
                    miner_key: miner
                });

                if (response.ok) {
                    const data = await response.json();
                    setAvailable(data.data);
                }
            } catch (error) {
                console.error('Error fetching stake availability:', error);
            }
        };

        if (miner) {
            fetchAvailable();
        }
    }, [miner, activeAccount]);

    useEffect(() => {
        if (!modals[modalName]) {
            setAcknowledged(false);
        }
    }, [modals, modalName]);

    const getButtonLabel = () => {
        if (isLegacyUnlock) {
            return isLoading ? 'Processing...' : 'Withdraw legacy stake';
        }

        if (available.available) {
            return isLoading ? 'Processing...' : 'Withdraw';
        }

        const remainingMs = Math.max(0, available.availableIn - Date.now());
        const days = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
        if (days > 0) {
            return `${days} day${days === 1 ? '' : 's'}`;
        }
        const hours = Math.floor(remainingMs / (1000 * 60 * 60));
        if (hours > 0) {
            return `${hours} hour${hours === 1 ? '' : 's'}`;
        }
        const minutes = Math.floor(remainingMs / (1000 * 60));
        const seconds = Math.floor((remainingMs % (1000 * 60)) / 1000);
        return `${minutes}m ${seconds}s`;
    };

    // Handle stake withdrawal
    const handleWithdrawal = async () => {
        setIsLoading(true);
        try {
            const response = await secureFetch('/api/stake/stake-withdraw', {
                address: activeAccount?.address,
                miner_key: miner
            });

            if (response.ok) {
                const data = await response.json();
                setUpdateSuccess('Your stake has been withdrawn successfully');
                setDisabled(true);
                router.reload();
            } else {
                setUpdateSuccess('error');
            }
        } catch (error) {
            console.error('Error during withdrawal:', error);
            setUpdateSuccess('error');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <Dialog open={modals[modalName]} onClose={() => closeModal(modalName)} static={true} className="z-[100]">
        <DialogPanel className="max-w-xl bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
                <div className="absolute right-0 top-0 pr-3 pt-3">
                    <button
                        type="button"
                        className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
                        onClick={() => closeModal(modalName)}
                        aria-label="Close"
                    >
                        <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
                    </button>
                </div>

                {/* Success Callout */}
                {updateSuccess && updateSuccess !== 'error' && (
                    <Callout className="mt-4 mb-4" title="Success" icon={CheckCircleIcon} color="teal">
                        {updateSuccess}
                    </Callout>
                )}

                {/* Error Callout */}
                {updateSuccess === 'error' && (
                    <Callout className="mt-4 mb-4" title="Error" icon={CheckCircleIcon} color="red">
                        Error sending transaction. Please contact us before trying again!
                    </Callout>
                )}

                {isLegacyUnlock && (
                    <Callout className="mt-4 mb-4" title="Legacy FRY 1.0 stake" icon={CheckCircleIcon} color="rose">
                        This miner is still staked with the retired FRY 1.0 token. Withdraw below to reclaim the funds,
                        then re-stake with FRY 2.0 to restore verification rewards.
                    </Callout>
                )}

                <form onSubmit={(e) => e.preventDefault()}>
                    <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                        Withdraw your verification stake ({staked} $FRY)
                    </h4>
                    <p className="text-gray-900 dark:text-gray-100">
                        Withdrawing your stake will remove your miner from the verification list. You will lose the verification multiplier and only earn base rewards until you re-stake with FRY 2.0.
                    </p>

                    <label className="mt-3 flex items-center gap-2 text-sm text-[#3c1e00] dark:text-warning-100">
                        <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-warning-700 text-warning-700 focus:ring-warning-500 dark:border-warning-200 dark:text-warning-200"
                            checked={acknowledged}
                            onChange={(event) => setAcknowledged(event.target.checked)}
                        />
                        <span>I understand withdrawing now removes my multiplier until I re-stake.</span>
                    </label>

                    <Button
                        className="mt-4 border-red-600 text-white bg-transparent hover:bg-red-600 hover:border-red-600"
                        onClick={handleWithdrawal}
                        disabled={isLoading || (!available.available && !isLegacyUnlock) || disabled || !acknowledged}
                    >
                        {getButtonLabel()}
                    </Button>
                </form>
            </DialogPanel>
        </Dialog>
    );
}
