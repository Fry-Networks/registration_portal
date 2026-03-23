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
import { useCallback, useEffect, useState } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { CheckCircleIcon } from '@heroicons/react/outline';
import { useModal } from '../../app/modalcontext';
import { getFRYPrice } from '../../lib/price';
import { useRouter } from 'next/router';
import { useToastContext } from '../../hooks/ToastContext';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { buildAssetTransferTxn } from '../../lib/wallet/transactions';
import { WalletRequestInFlightError } from '../../lib/wallet/requestCoordinator.client';
import { useSmartRetry } from '../../lib/hooks/useSmartRetry';
import { FRY_2 } from '../../lib/utils';
import { secureFetch } from '../../lib/api/secureFetch';
import { getAssetBalance as getStakeAssetBalance } from '../../lib/algorand/balances';

const STAKE_ADDRESS = 'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';
const FRY_VERIFICATION_ASSET_ID = FRY_2.id;

export default function StakeVerification({ modalName, miner, byod }: { modalName: string, miner?: string, byod: boolean }) {
    const router = useRouter();
    const { modals, closeModal } = useModal();
    const { activeAddress, signAndSubmit } = useWalletActions();
    const toast = useToastContext();
    const { executeWithRetry: executeWalletRetry } = useSmartRetry('wallet_signing');
    const [updateSuccess, setUpdateSuccess] = useState<string>("");
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [paid, setPaid] = useState<boolean>(false);
    const [FRYamount, setFRYAmount] = useState<{ stake_one: number, stake_two: number, stake_one_usd?: number, stake_two_usd?: number }>({ stake_one: 0, stake_two: 0 });
    // FIP-012: Track if price fetch failed
    const [priceError, setPriceError] = useState<string | null>(null);

    // Added helper so the legacy stake modal can automatically opt the connected wallet
    // into FRY 2.0 when the staking asset has not been added yet.
    const requestAssetOptIn = useCallback(
        async (): Promise<boolean> => {
            if (!activeAddress) {
                return false;
            }

            try {
                toast.info({
                    heading: 'Opt-in required',
                    message: 'Approve the FRY 2.0 opt-in transaction to continue.'
                });

                const encodedTransaction = await buildAssetTransferTxn({
                    sender: activeAddress,
                    receiver: activeAddress,
                    assetId: Number(FRY_VERIFICATION_ASSET_ID),
                    amount: 0,
                    useRawAmount: true
                });

                await executeWalletRetry(
                    async () => {
                        const [txId] = await signAndSubmit([encodedTransaction], {
                            message: 'Opt-in to FRY 2.0'
                        });
                        if (!txId) {
                            throw new Error('Opt-in transaction cancelled.');
                        }
                        return txId;
                    },
                    { operationType: 'asset opt-in' }
                );

                toast.success({
                    heading: 'Opt-in complete',
                    message: 'Wallet is now opted into FRY 2.0.'
                });
                return true;
            } catch (error) {
                const friendly = error instanceof Error ? error.message : 'Opt-in transaction failed.';
                toast.error({
                    heading: 'Opt-in failed',
                    message: friendly
                });
                return false;
            }
        },
        [activeAddress, executeWalletRetry, signAndSubmit, toast]
    );

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
    
                // FIP-012: Handle 503 price unavailable error
                if (response.status === 503) {
                    const errorData = await response.json().catch(() => null);
                    setPriceError(errorData?.message || 'Price unavailable. Please try again later.');
                    setFRYAmount({ stake_one: 0, stake_two: 0 });
                    return;
                }

                if (!response.ok) {
                    throw new Error('Failed to fetch stake amounts');
                }
    
                const data = await response.json();
                let stake_data = data.data.stake as { stake_one: number, stake_two: number, stake_one_usd?: number, stake_two_usd?: number };
    
                // BYOD discount applied to FRY amount (USD discount handled server-side)
                if (byod) {
                    stake_data = {
                        ...stake_data,
                        stake_one: Math.floor(stake_data.stake_one / 2),
                        stake_two: Math.floor(stake_data.stake_two / 2),
                        // BYOD 50% discount on USD amount too
                        stake_one_usd: stake_data.stake_one_usd ? stake_data.stake_one_usd / 2 : undefined,
                        stake_two_usd: stake_data.stake_two_usd ? stake_data.stake_two_usd / 2 : undefined,
                    };
                }
    
                setPriceError(null);
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
            const note = new Uint8Array(Buffer.from(`Verification stake${Math.floor(Math.random() * 1000)}`));
            toast.info({
                heading: 'Signature required',
                message: 'Approve the verification stake in your wallet to continue.'
            });

            // Guard: automatically opt the wallet into FRY 2.0 when the asset is missing.
            if (activeAddress) {
                const stakeBalance = await getStakeAssetBalance(activeAddress, String(FRY_VERIFICATION_ASSET_ID));
                if (stakeBalance === null) {
                    const optedIn = await requestAssetOptIn();
                    if (!optedIn) {
                        throw new Error('Opt-in is required before staking.');
                    }
                }
            }

            const encodedTransaction = await buildAssetTransferTxn({
                sender: from,
                receiver: to,
                amount,
                assetId: Number(FRY_VERIFICATION_ASSET_ID),
                note
            });

        const txId = await executeWalletRetry(
            async () => {
                const [signedTxId] = await signAndSubmit([encodedTransaction], {
                    message: 'Authorize verification stake transfer'
                });
                if (!signedTxId) {
                    throw new Error('Transaction id missing');
                }
                return signedTxId;
            },
            { operationType: 'verification stake', amount }
        );

        console.log('Successfully sent transaction. Transaction ID:', txId);
        return txId;
    } catch (error) {
        if (error instanceof WalletRequestInFlightError) {
            // Wallet already has a pending request; surface guidance instead of rethrowing a generic error.
            toast.info({
                heading: 'Wallet Request In Progress',
                message: 'Finish the current wallet prompt, then retry the verification stake.'
            });
            return null;
        }
        console.error("Transaction failed:", error);
        return null;
    }
};

    const handleStake = async (type: "one" | "two") => {
        setIsLoading(true);

        try {
            const FRYPrice = await getFRYPrice(FRY_VERIFICATION_ASSET_ID);

            if (!FRYPrice || !miner || !activeAddress) {
                setUpdateSuccess('error');
                setIsLoading(false);
                return;
            }

            const amountToStake = FRYamount[`stake_${type}`];
            
            // FIP-012: Prevent staking with 0 amount (price unavailable)
            if (!amountToStake || amountToStake <= 0) {
                setUpdateSuccess('error');
                toast.error({
                    heading: 'Cannot Stake',
                    message: 'Stake amount is unavailable. Please refresh and try again.'
                });
                setIsLoading(false);
                return;
            }

            const txId = await sendTransaction(activeAddress, STAKE_ADDRESS, amountToStake);

            if (txId) {
                setUpdateSuccess('Successfully sent transaction. Your miner will be verified soon.');
                setTimeout(() => setUpdateSuccess(""), 15000);

                // FIP-012: Include original_usd_amount in API call if USD peg is active
                const usdAmount = FRYamount[`stake_${type}_usd` as keyof typeof FRYamount];

                const response = await secureFetch('/api/stake/verification', {
                    txId,
                    address: activeAddress,
                    miner_key: miner,
                    type,
                    amount: amountToStake,
                    asset_id: String(FRY_VERIFICATION_ASSET_ID),
                    // FIP-012: Send USD amount if available
                    ...(typeof usdAmount === 'number' && usdAmount > 0 ? { original_usd_amount: usdAmount } : {})
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

    // FIP-012: Format display with USD equivalent
    const formatStakeDisplay = (fryAmount: number, usdAmount?: number) => {
        const fryFormatted = fryAmount.toLocaleString();
        if (typeof usdAmount === 'number' && usdAmount > 0) {
            return `${fryFormatted} FRY 2.0 (~$${usdAmount.toFixed(2)} USD)`;
        }
        return `${fryFormatted} FRY 2.0`;
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

                {/* FIP-012: Show price error if price unavailable */}
                {priceError && (
                <Callout className="mt-4 mb-4" title="Price Unavailable" color="yellow">
                    {priceError}
                </Callout>
                )}

                <form>
                <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    Stake for verification
                </h4>
                <p className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                    All FRY 2.0 sent will be locked for 24h OR 6 months before you can withdraw them again.
                </p>

                <div className="flex flex-col md:flex-row gap-4 mt-4">
                    <Button
                    className="w-full md:w-auto"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleStake("one");
                    }}
                    disabled={isLoading || paid || FRYamount.stake_one === 0 || !!priceError}
                    >
                    {isLoading ? 'Processing...' : `Stake (${formatStakeDisplay(FRYamount.stake_one, FRYamount.stake_one_usd)}) 24h Lock`}
                    </Button>

                    <Button
                    className="w-full md:w-auto"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleStake("two");
                    }}
                    disabled={isLoading || paid || FRYamount.stake_two === 0 || !!priceError}
                    >
                    {isLoading ? 'Processing...' : `Stake (${formatStakeDisplay(FRYamount.stake_two, FRYamount.stake_two_usd)}) 6 months Lock`}
                    </Button>
                </div>
                </form>
            </DialogPanel>
        </Dialog>
    );
}
