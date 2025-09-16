import React, { useEffect } from 'react'
import { useWallet } from '@txnlab/use-wallet-react'
import { Button, Flex, Select } from '@tremor/react'
import { signOut } from 'next-auth/react';

export default function ConnectMenu() {
    const { wallets, activeAccount } = useWallet()
    useEffect(() => {
        if (activeAccount) {
            localStorage.setItem('walletAddress', activeAccount?.address);
        }
    }, [activeAccount]);
    return (
        <Flex flexDirection='col' justifyContent='between' alignItems='center'>
            <Flex flexDirection='row' justifyContent='between' alignItems='center'>
                {wallets?.map((wallet) => (
                    <Flex key={wallet.id} flexDirection='col' justifyContent='center' alignItems='center'>


                        <img
                            width={30}
                            height={30}
                            alt={`${wallet.metadata.name} icon`}
                            src={wallet.metadata.icon}
                        />
                        {wallet.metadata.name}
                        <Button className='mb-2' onClick={wallet.connect} disabled={wallet.isConnected || !!activeAccount} color={wallet.isConnected ? 'green' : 'blue'}>
                            {wallet.isConnected ? 'Connected' : 'Connect'}
                        </Button>

                        {wallet.isActive && wallet.accounts.length > 0 && (
                            <>
                                <Button onClick={() => {
                                    wallet.disconnect()
                                    signOut()
                                }
                                } disabled={!wallet.isConnected} color='red' className='mb-2'>
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
