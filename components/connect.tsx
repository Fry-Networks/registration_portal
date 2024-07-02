import React from 'react'
import { useWallet } from '@txnlab/use-wallet'
import { Button, Flex, Select } from '@tremor/react'

export default function ConnectMenu() {
    const { providers, activeAccount } = useWallet()
    return (
        <Flex flexDirection='col' justifyContent='between' alignItems='center'>
            <Flex flexDirection='row' justifyContent='between' alignItems='center'>
                {providers?.filter(provider => {
                    return activeAccount ? provider.metadata.id == activeAccount.providerId : true
                }).map((provider) => (
                    <Flex key={provider.metadata.id} flexDirection='col' justifyContent='center' alignItems='center'>


                        <img
                            width={30}
                            height={30}
                            alt={`${provider.metadata.name} icon`}
                            src={provider.metadata.icon}
                        />
                        {provider.metadata.name}
                        <Button className='mb-2' onClick={provider.connect} disabled={provider.isConnected || !!activeAccount} color={provider.isConnected ? 'green' : 'blue'}>
                            {provider.isConnected ? 'Connected' : 'Connect'}
                        </Button>

                        {provider.isActive && provider.accounts.length && (
                            <>
                             <Button onClick={provider.disconnect} disabled={!provider.isConnected} color='red' className='mb-2'>
                             Disconnect
                           </Button>
                            <Select
                                value={activeAccount?.address}
                                onValueChange={(value) => provider.setActiveAccount(value)}
                            >
                                {provider.accounts.map((account) => (
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
            {activeAccount && (<p style={{marginTop: "15px"}}>You are successfully connected and can now head to the Vote page to cast your vote!</p>)}
        </Flex>

    )
}