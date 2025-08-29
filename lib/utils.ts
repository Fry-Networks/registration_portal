import { Device, Product, Asset } from './types';
import algosdk, { Indexer, Account } from 'algosdk';
import {
  poolUtils,
  SupportedNetwork,
  Swap,
  SwapType,
  SignerTransaction
} from '@tinymanorg/tinyman-js-sdk';
import {
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_PORT
} from '@txnlab/use-wallet';
import { AssetWithIdAndDecimals } from '@tinymanorg/tinyman-js-sdk/dist/util/asset/assetModels';

const DEFAULT_INDEX_BASEURL = 'https://mainnet-idx.algonode.cloud/';
const CUSTOME_INDEX_URL = 'https://mainnet-idx.4160.nodely.io/';
const API_TOKEN = 'REDACTED_ROTATE_ME';

export const algodClient = new algosdk.Algodv2(
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_PORT
);

export const indexerClient = new Indexer(
  DEFAULT_NODE_TOKEN,
  DEFAULT_INDEX_BASEURL,
  DEFAULT_NODE_PORT
);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export const FC_UNCHECKED = 0;
export const FC_CHECKED = 1;
export const FC_STARTED = 2;

export const FRY_1 = { id: '924268058', decimals: 6 } as Asset;
export const FRY_2 = { id: '2485314946', decimals: 6 } as Asset;
export const fNODE = { id: '2485202024', decimals: 6 } as Asset;
export const fVPN = { id: '2485198745', decimals: 6 } as Asset;
export const ALGO = { id: '0', decimals: 6 } as Asset;

export const REWALD_WALLET =
  'HXWYLLZDPTM5OXS3DPARMTG52RSBMMCQNKT4L2LZRRXYPNAWJBT6VIW6WU';
export const FRYALGO_WALLET =
  'ATPVJYGEGP5H6GCZ4T6CG4PK7LH5OMWXHLXZHDPGO7RO6T3EHWTF6UUY6E';
export const BURN_WALLET =
  'MO3FUXGKGZRTVYOSCXR3FXMPZQCZHR2BGGT2B5SINVBA3W6YCZNO25GGLM';

export const CORE_RELEASE_DATE = new Date('2025-07-21T00:00:00Z');
export const MODS_RELEASE_DATE = new Date('2025-07-25T00:00:00Z');
export const ALL_RELEASE_DATE = new Date('2025-08-01T00:00:00Z');

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

export const getFRYAssetBalances = async (assetId: string): Promise<number> => {
  try {
    const accountInfo = await algodClient
      .accountInformation(REWALD_WALLET)
      .do();

    const asset = accountInfo.assets.find(
      (a: any) => a['asset-id'] === parseInt(assetId)
    );

    if (asset) {
      return asset.amount / Math.pow(10, 6);
    } else {
      return 0;
      console.log('Wallet does not hold this asset.');
    }
  } catch (err) {
    console.error('Error fetching balance:', err);
    return 0;
  }
};

export const getAssetDecimals = async (
  assetId: number
): Promise<number | null> => {
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

export const getAssetName = (assetId: string) => {
  if (assetId === FRY_1.id) {
    return 'fry1.0';
  } else if (assetId === FRY_2.id) {
    return 'fry2.0';
  } else if (assetId === fNODE.id) {
    return 'fnode';
  } else if (assetId === fVPN.id) {
    return 'fvpn';
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

export const getTransactionTime = async (
  txId: string | undefined
): Promise<Date> => {
  try {
    // Fetch the transaction details
    if (txId !== undefined) {
      const txInfo = await indexerClient.lookupTransactionByID(txId).do();

      if (txInfo.transaction && txInfo.transaction['round-time']) {
        const transactionTime = new Date(
          txInfo.transaction['round-time'] * 1000
        );
        // console.log('transactionTime : ', transactionTime, new Date());
        return transactionTime;
      } else {
        return new Date();
      }
    }
    return new Date();
  } catch (error) {
    console.error('getTransactionTime: ', error);
    return new Date();
  }
};

// export const requestGasFee = async (from: string | undefined, signTransactions: any, sendTransactions: any): Promise<boolean> => {
//   try {

//     if (from === undefined)
//       return false;

//     const suggestedParams = await algodClient.getTransactionParams().do();
//     const to = getWalletAddress(process.env.REWARD_MNEMONIC!);

//     const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
//       from: from,
//       to: to,
//       amount: Number(1000), // Amount in microAlgos
//       suggestedParams: suggestedParams,
//     });

//     const encodedTxn = algosdk.encodeUnsignedTransaction(txn);
//     const signedTransactions = await signTransactions([encodedTxn]);
//     const waitRoundsToConfirm = 4;

//     const { id, txId } = await sendTransactions(
//       signedTransactions,
//       waitRoundsToConfirm
//     );

//     console.log('Fee payment txId: ', txId);

//     if (txId) {
//       return true;
//     }
//     return false;
//   } catch(error) {
//     console.error ("getGasFee : ", error);
//     return false;
//   }
// }

/**
 * @param account account data that will sign the transactions
 * @returns a function that will sign the transactions, can be used as `initiatorSigner`
 */
export const signerWithSecretKey = (account: Account, rekey: Account) => {
  return function (txGroups: SignerTransaction[][]): Promise<Uint8Array[]> {
    // Filter out transactions that don't need to be signed by the account
    const txnsToBeSigned = txGroups.flatMap((txGroup) =>
      txGroup.filter((item) => item.signers?.includes(account.addr))
    );
    // Sign all transactions that need to be signed by the account
    const signedTxns: Uint8Array[] = txnsToBeSigned.map(({ txn }) =>
      txn.signTxn(rekey.sk)
    );

    // We wrap this with a Promise since SDK's initiatorSigner expects a Promise
    return new Promise((resolve) => {
      resolve(signedTxns);
    });
  };
};

export const wait = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Executes a swap with a fixed input amount
 * (Input amount is entered by the user, output amount is to be calculated by the SDK)
 */
export const fixedInputSwap = async ({
  account,
  asset_1,
  asset_2,
  amount,
  rekey
}: {
  account: Account;
  asset_1: Asset;
  asset_2: Asset;
  amount: number;
  rekey: Account;
}) => {
  try {
    const initiatorAddr = account.addr;
    const pool = await poolUtils.v2.getPoolInfo({
      network: 'mainnet' as SupportedNetwork,
      client: algodClient,
      asset1ID: Number(asset_1.id),
      asset2ID: Number(asset_2.id)
    });

    console.log('Pool Info : ', pool);

    /**
     * This example uses only v2 quote. Similarly, we can use
     * Swap.getQuote method, which will return the best quote (highest rate)
     * after checking both v1 and v2
     */
    const fixedInputSwapQuote = await Swap.v2.getQuote({
      type: SwapType.FixedInput,
      // amount: testMode ? 0 : amount * Math.pow(10, asset_1.decimals || 0),
      amount: amount * Math.pow(10, asset_1.decimals || 0),
      assetIn: {
        id: Number(asset_1.id),
        decimals: asset_1.decimals
      } as AssetWithIdAndDecimals,
      assetOut: {
        id: Number(asset_2.id),
        decimals: asset_2.decimals
      } as AssetWithIdAndDecimals,
      network: 'mainnet' as SupportedNetwork,
      pool: pool,
      slippage: 0.05
    });

    let fixedInputSwapTxns = await Swap.v2.generateTxns({
      client: algodClient,
      network: 'mainnet' as SupportedNetwork,
      quote: fixedInputSwapQuote,
      swapType: SwapType.FixedInput,
      initiatorAddr,
      slippage: 0.05
    });

    console.log(
      'fixedInputSwapTxns : ',
      fixedInputSwapTxns.length,
      fixedInputSwapTxns[0].txn.txID(),
      fixedInputSwapTxns[1].txn.txID()
    );
    try {
      const txStatus = await algodClient
        .pendingTransactionInformation(fixedInputSwapTxns[0].txn.txID())
        .do();
      if (txStatus && txStatus['confirmed-round']) {
        while (true) {
          fixedInputSwapTxns = await Swap.v2.generateTxns({
            client: algodClient,
            network: 'mainnet' as SupportedNetwork,
            quote: fixedInputSwapQuote,
            swapType: SwapType.FixedInput,
            initiatorAddr,
            slippage: 0.05
          });

          try {
            const regeneratedTxStatus = await algodClient
              .pendingTransactionInformation(fixedInputSwapTxns[0].txn.txID())
              .do();
          } catch (error: any) {
            console.log('regeneratedTxStatus : ', error.response.status);
            break;
          }

          await wait(1000);
        }
      }
    } catch (error: any) {
      console.log('txStatus : ', error.response.status);
    }

    const signedTxns = await Swap.v2.signTxns({
      txGroup: fixedInputSwapTxns,
      initiatorSigner: signerWithSecretKey(account, rekey)
    });

    const swapExecutionResponse = await Swap.v2.execute({
      client: algodClient,
      quote: fixedInputSwapQuote,
      signedTxns,
      txGroup: fixedInputSwapTxns
    });

    console.log('✅ Fixed Input Swap executed successfully!');
    // console.log({response: swapExecutionResponse, txnID: swapExecutionResponse.txnID});

    return swapExecutionResponse;
  } catch (error) {
    console.error('fixedInputSwap :', error);
    return undefined;
  }
};
