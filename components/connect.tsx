import React, { useEffect } from 'react';
import Image from 'next/image';
import { useWallet } from '@txnlab/use-wallet-react';
import { Button, Flex, Select } from '@tremor/react';
import { signOut } from 'next-auth/react';
import { useToastContext } from '../hooks/ToastContext';
import { runWithWalletRequest, WalletRequestInFlightError } from '../lib/wallet/requestCoordinator.client';
import { useWalletPending } from '../lib/hooks/useWalletPending';

export default function ConnectMenu() {
    const { wallets, activeAccount } = useWallet();
    const toast = useToastContext();
    const { info: showInfo } = toast;
    const isWalletPending = useWalletPending();

    useEffect(() => {
        if (activeAccount) {
            localStorage.setItem('walletAddress', activeAccount?.address);
        }
    }, [activeAccount]);

    return (
        <Flex flexDirection='col' justifyContent='between' alignItems='center'>
            {/* Show pending message when wallet operation is in progress */}
            {isWalletPending && (
                <div className="mb-4 p-3 bg-warning-100 dark:bg-warning-900/30 border border-warning-300 dark:border-warning-700 rounded-lg text-warning-800 dark:text-warning-200 text-sm">
                    <strong>Transaction in progress</strong> — Please complete or cancel your current request in Pera Wallet.
                </div>
            )}
            <Flex flexDirection='row' justifyContent='between' alignItems='center'>
                {wallets?.map((wallet) => (
                    <Flex key={wallet.id} flexDirection='col' justifyContent='center' alignItems='center'>


                        <Image
                            width={30}
                            height={30}
                            alt={`${wallet.metadata.name} icon`}
                            src={wallet.metadata.icon}
                        />
                        {wallet.metadata.name}
                        <Button
                            className='mb-2'
                            onClick={async () => {
                                if (wallet.isConnected || !!activeAccount) {
                                    return;
                                }
                                try {
                                    await runWithWalletRequest(async () => {
                                        await wallet.connect();
                                    });
                                } catch (error) {
                                    // Avoid stacking wallet prompts when another request is already active.
                                    if (error instanceof WalletRequestInFlightError) {
                                        showInfo({
                                            heading: 'Wallet Request In Progress',
                                            message: 'Finish the current wallet prompt, then retry connecting.'
                                        });
                                        return;
                                    }

                                    const typedError = error as {
                                        name?: string;
                                        data?: { type?: string };
                                        cancelled?: boolean;
                                    } | undefined;

                                    const isWalletModalClosed =
                                        ((typedError?.name === 'PeraWalletConnectError' ||
                                            typedError?.name === 'DeflyWalletConnectError') &&
                                            typedError?.data?.type === 'CONNECT_MODAL_CLOSED') ||
                                        typedError?.cancelled;

                                    if (isWalletModalClosed) {
                                        showInfo({
                                            heading: 'Wallet request cancelled',
                                        });
                                        return;
                                    }

                                    console.error('Wallet connect failed', error);
                                    showInfo({
                                        heading: 'Wallet connection failed',
                                        message: 'We could not connect to your wallet. Please try again.'
                                    });
                                }
                            }}
                            disabled={wallet.isConnected || !!activeAccount || isWalletPending}
                            color={wallet.isConnected ? 'green' : 'blue'}
                        >
                            {isWalletPending ? 'Pending...' : (wallet.isConnected ? 'Connected' : 'Connect')}
                        </Button>

                        {wallet.isActive && wallet.accounts.length > 0 && (
                            <>
                                <Button onClick={() => {
                                    wallet.disconnect()
                                    signOut()
                                }
                                } disabled={!wallet.isConnected || isWalletPending} color='red' className='mb-2'>
                                    Disconnect
                                </Button>
                                <Select
                                    value={activeAccount?.address}
                                    onValueChange={(value) => wallet.setActiveAccount(value)}
                                >
                                    {wallet.accounts.map((account) => (
                                        <option key={account.address} value={account.address}>
                                            {account.address}
                                        </option>
                                    ))}
                                </Select>
                            </>
                        )}


                    </Flex>

                ))}

            </Flex>
            {activeAccount && (<p style={{ marginTop: "15px" }}>You are successfully connected and can now wander in the dashboard!</p>)}
        </Flex>

    )
}
