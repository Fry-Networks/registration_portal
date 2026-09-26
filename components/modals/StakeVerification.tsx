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
import { useRouter } from 'next/router';
import { useToastContext } from '../../hooks/ToastContext';
import { useWalletActions } from '../../lib/wallet/useWalletActions';
import { buildAssetTransferTxn } from '../../lib/wallet/transactions';
import { WalletRequestInFlightError } from '../../lib/wallet/requestCoordinator.client';
import { useSmartRetry } from '../../lib/hooks/useSmartRetry';
import { FRY_2 } from '../../lib/utils';
import { secureFetch } from '../../lib/api/secureFetch';
import { getAssetBalance as getStakeAssetBalance } from '../../lib/algorand/balances';
import {
    MIN_FEE_HEADROOM_MICROALGO,
    STAKE_PREFLIGHT_TIMEOUT_MS,
    STAKE_SIGN_TIMEOUT_MS,
    describeStakeError,
    formatAlgo,
    getAccountFunding,
    isValidStakeAmount,
    withStakeTimeout
} from '../../lib/wallet/stakeSigning';

const STAKE_ADDRESS = 'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';
const FRY_VERIFICATION_ASSET_ID = FRY_2.id;

type StakeTier = 'one' | 'two';

export default function StakeVerification({ modalName, miner, byod, alreadyVerified }: { modalName: string, miner?: string, byod: boolean, alreadyVerified?: boolean }) {
    const router = useRouter();
    const { modals, closeModal } = useModal();
    const { activeAddress, signAndSubmit } = useWalletActions();
    const toast = useToastContext();
    const { executeWithRetry: executeWalletRetry } = useSmartRetry('wallet_signing');
    const [updateSuccess, setUpdateSuccess] = useState<string>("");
    // B24: the reason a stake failed, shown verbatim in the modal. Previously every failure
    // collapsed into one "Please contact us" callout, so a rejected signature, an insufficient
    // balance and an unreachable node were indistinguishable to the user.
    const [errorMessage, setErrorMessage] = useState<string>("");
    // B24: which tier is in flight, rather than one shared boolean. A single `isLoading` flag put
    // BOTH tier buttons into "Processing..." on one click, which is what users reported.
    const [pendingTier, setPendingTier] = useState<StakeTier | null>(null);
    const [paid, setPaid] = useState<boolean>(false);
    const [FRYamount, setFRYAmount] = useState<{ stake_one: number, stake_two: number }>({ stake_one: 0, stake_two: 0 });

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

                const encodedTransaction = await withStakeTimeout(
                    buildAssetTransferTxn({
                        sender: activeAddress,
                        receiver: activeAddress,
                        assetId: Number(FRY_VERIFICATION_ASSET_ID),
                        amount: 0,
                        useRawAmount: true
                    }),
                    STAKE_PREFLIGHT_TIMEOUT_MS,
                    'build'
                );

                await executeWalletRetry(
                    async () => {
                        const [txId] = await withStakeTimeout(
                            signAndSubmit([encodedTransaction], {
                                message: 'Opt-in to FRY 2.0'
                            }),
                            STAKE_SIGN_TIMEOUT_MS,
                            'signing'
                        );
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
                const friendly = describeStakeError(error);
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
                setErrorMessage('Could not load the staking amounts for this device. Reload the page and try again.');
            }
        };
    
        fetchMinerTypes();
    }, [miner, activeAddress, byod]);
    

    // Throws on every failure so the caller can show the real reason. Each awaited step is time
    // bounded: none of algosdk, lib/algorand/withRetry.ts or the wallet SDKs impose a deadline, and
    // an unbounded await here is what left the modal on "Processing..." forever (B24).
    const sendTransaction = async (from: string, to: string, amount: number) => {
        const note = new Uint8Array(Buffer.from(`Verification stake${Math.floor(Math.random() * 1000)}`));

        // Fry accounts are routinely funded to exactly their min-balance, which leaves nothing
        // spendable to pay the network fee. algod then rejects the transfer AFTER the user has
        // signed it, and the logs show exactly that. Note this is NOT the check the sibling modal
        // makes: lib/algorand/balances.ts `getAlgoBalance` returns the TOTAL balance, so a
        // zero-headroom account reports a healthy figure and slips straight through it.
        const funding = await withStakeTimeout(
            getAccountFunding(from),
            STAKE_PREFLIGHT_TIMEOUT_MS,
            'fees'
        );
        if (funding.spendableMicros < MIN_FEE_HEADROOM_MICROALGO) {
            throw new Error(
                `Your wallet has no spendable ALGO for network fees. It holds ${formatAlgo(funding.amountMicros)} ALGO but ${formatAlgo(funding.minBalanceMicros)} ALGO is locked as the minimum balance. Add a little ALGO and try again.`
            );
        }

        // Guard: automatically opt the wallet into FRY 2.0 when the asset is missing.
        let stakeBalance = await withStakeTimeout(
            getStakeAssetBalance(from, String(FRY_VERIFICATION_ASSET_ID)),
            STAKE_PREFLIGHT_TIMEOUT_MS,
            'balance'
        );
        if (stakeBalance === null) {
            const optedIn = await requestAssetOptIn();
            if (!optedIn) {
                throw new Error('Opt-in is required before staking.');
            }
            stakeBalance = 0;
        }

        // Refuse before signing rather than after. An under-funded transfer is accepted by the
        // wallet and then rejected by the node ("underflow on subtracting ... from sender amount"
        // in logs/error-*.json), which costs the user a signature for nothing.
        if (stakeBalance < amount) {
            throw new Error(
                `You need at least ${amount} FRY 2.0 to stake. Current balance: ${stakeBalance}`
            );
        }

        // Guard against triggering an on-chain stake when the API rate limit will reject the
        // update, matching components/modals/Stake.tsx.
        const precheckResponse = await withStakeTimeout(
            secureFetch('/api/stake/precheck', {
                miner_key: miner,
                address: from,
                context: 'verification'
            }),
            STAKE_PREFLIGHT_TIMEOUT_MS,
            'precheck'
        );
        if (!precheckResponse.ok) {
            const details = await precheckResponse.json().catch(() => null);
            throw new Error(
                details?.message ?? 'Too many staking requests right now. Please wait before trying again.'
            );
        }

        const encodedTransaction = await withStakeTimeout(
            buildAssetTransferTxn({
                sender: from,
                receiver: to,
                amount,
                assetId: Number(FRY_VERIFICATION_ASSET_ID),
                note
            }),
            STAKE_PREFLIGHT_TIMEOUT_MS,
            'build'
        );

        // Only now has anything actually been asked of the wallet. This toast used to be the first
        // statement in the function, so every failure above it told the user to approve a request
        // that had never been sent.
        toast.info({
            heading: 'Signature required',
            message: 'Approve the verification stake in your wallet to continue.'
        });

        const txId = await executeWalletRetry(
            async () => {
                const [signedTxId] = await withStakeTimeout(
                    signAndSubmit([encodedTransaction], {
                        message: 'Authorize verification stake transfer'
                    }),
                    STAKE_SIGN_TIMEOUT_MS,
                    'signing'
                );
                if (!signedTxId) {
                    throw new Error('Transaction id missing');
                }
                return signedTxId;
            },
            { operationType: 'verification stake', amount }
        );

        console.log('Successfully sent transaction. Transaction ID:', txId);
        return txId;
    };

    const handleStake = async (type: StakeTier) => {
        setPendingTier(type);
        setErrorMessage("");

        try {
            if (!miner || !activeAddress) {
                setErrorMessage('Connect your wallet and reopen this device before staking.');
                return;
            }

            const amountToStake = FRYamount[`stake_${type}`];
            // The amount is the figure this flow has to get right. /api/stake-amount returns
            // product.reward.stake verbatim -- its USD/price division is commented out -- so there
            // is no price to apply here, and the old `getFRYPrice()` gate only ever added a way for
            // an unrelated price-feed outage to block staking with no explanation.
            if (!isValidStakeAmount(amountToStake)) {
                setErrorMessage('No staking amount is configured for this device. Contact support before trying again.');
                return;
            }

            const txId = await sendTransaction(activeAddress, STAKE_ADDRESS, amountToStake);

            setUpdateSuccess('Successfully sent transaction. Your miner will be verified soon.');
            setTimeout(() => setUpdateSuccess(""), 15000);

            const response = await secureFetch('/api/stake/verification', {
                txId,
                address: activeAddress,
                miner_key: miner,
                type,
                amount: amountToStake,
                asset_id: String(FRY_VERIFICATION_ASSET_ID)
            });

            if (response.ok) {
                setUpdateSuccess('Your miner has been verified.');
                setPaid(true);
                router.reload();
            } else {
                // The transfer is already on chain at this point, so say so instead of implying
                // nothing happened.
                const details = await response.json().catch(() => null);
                setUpdateSuccess("");
                setErrorMessage(
                    `${details?.message ?? 'The stake was sent but could not be recorded.'} Your transaction id is ${txId} — keep it and contact support.`
                );
            }
        } catch (error) {
            if (error instanceof WalletRequestInFlightError) {
                // Wallet already has a pending request; surface guidance instead of a generic error.
                toast.info({
                    heading: 'Wallet Request In Progress',
                    message: 'Finish the current wallet prompt, then retry the verification stake.'
                });
                setErrorMessage('Your wallet already has a request open. Finish or dismiss it, then try again.');
                return;
            }
            console.error("Stake failed:", error);
            setErrorMessage(describeStakeError(error));
        } finally {
            setPendingTier(null);
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

                {updateSuccess && (
                <Callout className="mt-4 mb-4" title="Success" icon={CheckCircleIcon} color="teal">
                    {updateSuccess}
                </Callout>
                )}

                {errorMessage && (
                <Callout className="mt-4 mb-4" title="Error" icon={CheckCircleIcon} color="red">
                    {errorMessage}
                </Callout>
                )}

                <form>
                <h4 className="font-semibold text-tremor-content-strong dark:text-dark-tremor-content-strong">
                    Stake for verification
                </h4>
                <p className="text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                    All FRY 2.0 sent will be locked for 24h OR 6 months before you can withdraw them again.
                </p>

                {/* A device can read as "Verified" on My Registrations and still be offered this
                    stake: for a FEM- key that badge is computed from registration completeness, not
                    from the stake. Explain what the stake adds rather than hiding the modal, which
                    would dead-end every verification-exempt device the device card sends here. */}
                {alreadyVerified && (
                <p className="mt-2 text-tremor-content-subtle dark:text-dark-tremor-content-subtle">
                    This device is already marked verified. Staking is still available and records a
                    locked FRY 2.0 stake against it, which is what enables &quot;Withdraw stake&quot;
                    once the lock period you pick below has elapsed.
                </p>
                )}

                <div className="flex flex-col md:flex-row gap-4 mt-4">
                    <Button
                    className="w-full md:w-auto"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleStake("one");
                    }}
                    disabled={pendingTier !== null || paid || FRYamount.stake_one === 0}
                    >
                    {pendingTier === 'one' ? 'Processing...' : `Stake (${FRYamount.stake_one} FRY 2.0) 24h Lock`}
                    </Button>

                    <Button
                    className="w-full md:w-auto"
                    color="blue"
                    onClick={async (e) => {
                        e.preventDefault();
                        await handleStake("two");
                    }}
                    disabled={pendingTier !== null || paid || FRYamount.stake_two === 0}
                    >
                    {pendingTier === 'two' ? 'Processing...' : `Stake (${FRYamount.stake_two} FRY 2.0) 6 months Lock`}
                    </Button>
                </div>
                </form>
            </DialogPanel>
        </Dialog>
    );
}
