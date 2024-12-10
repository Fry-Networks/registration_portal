import { Device, Product } from './types';
import algosdk from 'algosdk';

export const isRegistrationNeeded = (product: Product) => {
  const isTokenTypeValid =
    product.reward.tokens?.register &&
    product.reward.tokens.register !== 'none';
  const isTokenAmountValid =
    product.reward.stake?.register && product.reward.stake.register > 0;

  return isTokenAmountValid && isTokenTypeValid;
};

export const isNodeStakingNeeded = (product: Product) => {
  const isTokenTypeValid =
    product.reward.tokens?.node && product.reward.tokens.node !== 'none';
  const isTokenAmountValid =
    product.reward.stake?.node && product.reward.stake.node > 0;

  return isTokenAmountValid && isTokenTypeValid;
};

export const isRegistartionStaked = (device: Device) => {
  if (device.registration && device.registration.amount !== 0) {
    return true;
  }

  return false;
};

export const isNodeProduct = (product: Product) => {
  return product.name.includes('Node');
};

export const isNodeStaked = (device: Device) => {
  if (device.node && device.node.amount !== 0) {
    return true;
  }

  return false;
};

export const getWalletAddress = (mnemonic: string) => {
  if (mnemonic.length > 0) {
    const account = algosdk.mnemonicToSecretKey(mnemonic);

    return account.addr;
  }
  return '';
};

export const getAlgoBalance = async (address: string) => {
  try {
    const response = await fetch('api/algorand/get-algo-balance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ address: address })
    });

    if (!response.ok) {
      return 0;
    }

    const result = await response.json();
    if (result.success) {
      return result.balance;
    } else {
      return 0;
    }
  } catch (error) {
    console.error(error);
    return 0;
  }
};

export const getDeviceStatus = async (
  device: Device
): Promise<{ [key: string]: string } | undefined> => {
  try {
    const deviceStatus: { [key: string]: string } = {};
    const productResponse = await fetch('api/products/get-product', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ miner_key: device.miner_key })
    });

    if (!productResponse.ok) {
      return undefined;
    }

    const productResult = await productResponse.json();

    const product = productResult.data[0] as Product;
    let isError = false;

    if (!device.position) {
      deviceStatus.position = 'Not set';
      isError = true;
    }

    if (!device.reward_wallet) {
      deviceStatus.reward_wallet = 'Not set';
      isError = true;
    }

    if (!device.connectivity_wallet) {
      deviceStatus.connectivity_wallet = 'Not set';
      isError = true;
    }

    if (isRegistrationNeeded(product)) {
      if (!device.registration) {
        deviceStatus.registration = 'Not staked for registration';
        isError = true;
      } else if (
        device.registration.asset_id !== product.reward.tokens?.register
      ) {
        deviceStatus.registration =
          'Registration staking information is changed. Please check and stake again';
        isError = true;
      } else if (device.registration.amount === 0) {
        deviceStatus.registration = 'Not staked for registration';
        isError = true;
      }
    }

    if (isNodeStakingNeeded(product)) {
      if (!device.node) {
        deviceStatus.node = 'Not staked for node operation';
        isError = true;
      } else if (device.node.asset_id !== product.reward.tokens?.node) {
        deviceStatus.node =
          'Node staking information is changed. Please check and stake again';
        isError = true;
      } else if (device.node.amount === 0) {
        deviceStatus.node = 'Not staked for node operation';
        isError = true;
      }
    }

    if (isError) {
      return deviceStatus;
    } else {
      return undefined;
    }
  } catch (error) {
    console.error('Device Status: ' + error);
    return undefined;
  }

  return undefined;
};
