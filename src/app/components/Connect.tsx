import React from "react";
import { Provider, useWallet } from "@txnlab/use-wallet";

// Define styles for the buttons and select
const elementStyle = {
  backgroundColor: '#4CAF50', /* Green */
  border: 'none',
  color: 'white',
  padding: '15px 32px',
  textDecoration: 'none',
  display: 'inline-block',
  fontSize: '16px',
  margin: '4px 2px',
  cursor: 'pointer',
  borderRadius: '12px', // Rounded corners

};

interface ButtonProps {
  provider: Provider;
  style: React.CSSProperties;
  activeAccount?: any;
}

const DisconnectButton = ({ provider, style }: ButtonProps) => (
  <button
    onClick={provider.disconnect}
    disabled={!provider.isConnected}
    style={{
      ...style,
      backgroundColor: 'red',
    }}
  >
    Disconnect
  </button>
);

const ConnectButton = ({ provider, style }: ButtonProps) => (
  <button style={style} onClick={provider.connect}>
    Connect
  </button>
);

const AccountSelect = ({ provider, style, activeAccount }: ButtonProps) => (
  <select
    style={{
      ...style,
      width: undefined
    }}
    value={activeAccount ? activeAccount.address : "Address"}
    onChange={(e) => provider.setActiveAccount(e.target.value)}
  >
    <option value="Address" disabled>Address</option>
    {provider.accounts.map((account) => (
      <option
        key={"account-" + account.address}
        value={account.address}
      >
        {account.address}
      </option>
    ))}
  </select>
);

export default function Connect() {
  const { providers, activeAccount } = useWallet();

  // Check if any provider is connected
  const anyConnected = providers?.some(provider => provider.isConnected);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap', // Allow items to wrap as necessary
      justifyContent: 'center',
      alignItems: 'center',
      textAlign: 'center'
    }}>
      {providers?.map((provider) => (
        (provider.isConnected || !anyConnected) && (
          <div key={"provider-" + provider.metadata.id} style={{
            margin: '0 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            position: 'relative',
            flexBasis: 'auto', // Each item will shrink or grow as necessary
            marginBottom: '20px' // Add a margin to prevent items from sticking together when they wrap
          }}>


            <h4 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img width={30} height={30} alt="" src={provider.metadata.icon} style={{ marginRight: '10px' }} />
              {provider.metadata.name} {provider.isActive && "[active]"}
            </h4>


            {/* Show the connect button if no provider is connected */}
            {!anyConnected && <ConnectButton provider={provider} style={elementStyle} />}

            {/* Show the account select if the provider is connected */}
              {provider.isConnected && provider.isActive && provider.accounts.length && (
                <AccountSelect
                provider={provider}
                style={{
                  ...elementStyle,
                  maxWidth: '300px', // Or whatever max width you want
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                activeAccount={activeAccount}
              />
              
              )}
            {/* Show the disconnect button if the provider is connected */}
            {provider.isConnected && <DisconnectButton provider={provider} style={elementStyle} />}





          </div>
        )
      ))}
    </div>
  );
}
