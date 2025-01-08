import { Device, Product } from './types';
import algosdk, { Indexer, Account } from 'algosdk';
import { poolUtils, SupportedNetwork, Swap, SwapType, SignerTransaction, ALGO_ASSET_ID } from "@tinymanorg/tinyman-js-sdk";
import { 
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_PORT,
 } from '@txnlab/use-wallet'
import { AssetWithIdAndDecimals } from '@tinymanorg/tinyman-js-sdk/dist/util/asset/assetModels';

const indexServer = 'https://mainnet-idx.algonode.cloud/';

export const algodClient = new algosdk.Algodv2(
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_PORT
)

export const indexerClient = new Indexer(
  DEFAULT_NODE_TOKEN,
  indexServer,
  DEFAULT_NODE_PORT
)

export const FRY_1 = 924268058;
export const FRY_2 = 2485314946;
export const fNODE = 2485202024;
export const fVPN = 2485198745;
export const ALGO = 0;

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
  if (mnemonic?.length > 0) {
    const account = algosdk.mnemonicToSecretKey(mnemonic);

    return account.addr;
  }
  return '';
};

export const getAssetDecimals = async (assetId: number): Promise<number | null> => {
  try {
    const assetInfo = await indexerClient.lookupAssetByID(assetId).do();
    const decimals = assetInfo.asset.params.decimals;
    console.log(`Asset ID: ${assetId}, Decimals: ${decimals}`);
    return decimals;
  } catch (error) {
    console.error(`Failed to fetch asset info for Asset ID ${assetId}:`, error);
    return null;
  }
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


export const getTransactionTime = async (txId: string | undefined): Promise<string> => {
  try {
    // Fetch the transaction details
    if (txId !== undefined) {
      const txInfo = await indexerClient.lookupTransactionByID(txId).do();

      if (txInfo.transaction && txInfo.transaction["round-time"]) {
        const transactionTime = new Date(txInfo.transaction["round-time"] * 1000);
        return transactionTime.toDateString();
      } else {
        return "Transaction not yet confirmed.";
      }
    }
    return "Transaction not yet confirmed.";
  } catch (error) {
    return "Transaction not yet confirmed.";
  }
}

/**
 * @param account account data that will sign the transactions
 * @returns a function that will sign the transactions, can be used as `initiatorSigner`
 */
export const signerWithSecretKey = (account: Account) => {
  return function (txGroups: SignerTransaction[][]): Promise<Uint8Array[]> {
    // Filter out transactions that don't need to be signed by the account
    const txnsToBeSigned = txGroups.flatMap((txGroup) =>
      txGroup.filter((item) => item.signers?.includes(account.addr))
    );
    // Sign all transactions that need to be signed by the account
    const signedTxns: Uint8Array[] = txnsToBeSigned.map(({ txn }) =>
      txn.signTxn(account.sk)
    );

    // We wrap this with a Promise since SDK's initiatorSigner expects a Promise
    return new Promise((resolve) => {
      resolve(signedTxns);
    });
  };
}

/**
 * Executes a swap with a fixed input amount
 * (Input amount is entered by the user, output amount is to be calculated by the SDK)
 */
export const fixedInputSwap = async ({
  account,
  asset_1,
  asset_2
}: {
  account: Account;
  asset_1: Number;
  asset_2: Number;
}) => {
  const initiatorAddr = account.addr;
  const pool = await poolUtils.v2.getPoolInfo({
    network: "mainnet" as SupportedNetwork,
    client: algodClient,
    asset1ID: Number(asset_1),
    asset2ID: Number(asset_2)
  });

  console.log("Pool Info : ", pool);

  /**
   * This example uses only v2 quote. Similarly, we can use
   * Swap.getQuote method, which will return the best quote (highest rate)
   * after checking both v1 and v2
   */
  const fixedInputSwapQuote = await Swap.v2.getQuote({
    type: SwapType.FixedInput,
    amount: 100_000,
    assetIn: { id: asset_1, decimals: 6 } as AssetWithIdAndDecimals,
    assetOut: { id: asset_2, decimals: 6 } as AssetWithIdAndDecimals,
    network: "mainnet" as SupportedNetwork,
    pool: pool,
  });

  const fixedInputSwapTxns = await Swap.v2.generateTxns({
    client: algodClient,
    network: "testnet" as SupportedNetwork,
    quote: fixedInputSwapQuote,
    swapType: SwapType.FixedInput,
    initiatorAddr,
    slippage: 0.05
  });

  const signedTxns = await Swap.v2.signTxns({
    txGroup: fixedInputSwapTxns,
    initiatorSigner: signerWithSecretKey(account)
  });

  const swapExecutionResponse = await Swap.v2.execute({
    client: algodClient,
    quote: fixedInputSwapQuote,
    signedTxns,
    txGroup: fixedInputSwapTxns,
  });

  console.log("✅ Fixed Input Swap executed successfully!");
  console.log({txnID: swapExecutionResponse.txnID});
}