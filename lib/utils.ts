import { Device, Product, Asset } from './types';
import algosdk, { Indexer, Account } from 'algosdk';
// Use Tinyman's bundled algosdk for Tinyman operations to avoid API/type drift
import * as TinymanAlgo from '@tinymanorg/tinyman-js-sdk/node_modules/algosdk';
import {
  poolUtils,
  SupportedNetwork,
  Swap,
  SwapType,
  SignerTransaction
} from '@tinymanorg/tinyman-js-sdk';
// Mainnet API endpoints for production
const DEFAULT_NODE_BASEURL = 'https://mainnet-api.algonode.cloud';
const DEFAULT_NODE_TOKEN = '';
const DEFAULT_NODE_PORT = 443;
import { AssetWithIdAndDecimals } from '@tinymanorg/tinyman-js-sdk/dist/util/asset/assetModels';

const DEFAULT_INDEX_BASEURL = 'https://mainnet-idx.algonode.cloud';
const CUSTOME_INDEX_URL = 'https://mainnet-idx.4160.nodely.io';
const API_TOKEN = 'REDACTED_ROTATE_ME';

export const algodClient = new algosdk.Algodv2(
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_PORT
);
// Dedicated client instance using Tinyman's bundled algosdk (supports setIntDecoding at runtime & types)
const tinymanAlgodClient = new TinymanAlgo.Algodv2(
  DEFAULT_NODE_TOKEN,
  DEFAULT_NODE_BASEURL,
  DEFAULT_NODE_PORT
);

export const indexerClient = new Indexer(
  DEFAULT_NODE_TOKEN,
  DEFAULT_INDEX_BASEURL,
  DEFAULT_NODE_PORT
);

// Normalize Algorand asset identifiers so bigint responses compare correctly across the app.
export const normalizeAssetId = (value: unknown): number => {
  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  return Number(value ?? 0);
};

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export const FC_UNCHECKED = 0;
export const FC_CHECKED = 1;
export const FC_STARTED = 2;

export const FRY_1 = { id: '924268058', decimals: 6 } as Asset;
export const FRY_2 = { id: '2485314946', decimals: 6 } as Asset;
export const fNODE = { id: '2485202024', decimals: 6 } as Asset;
export const tFRY = { id: '2681521901', decimals: 6 } as Asset;
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

export const isRegistrationNeeded = (product: Product): boolean => {
  const isTokenTypeValid = !!(
    product.reward.tokens?.register &&
    product.reward.tokens.register !== 'none'
  );
  const isTokenAmountValid = !!(
    typeof product.reward.stake?.register === 'number' &&
    product.reward.stake.register > 0
  );

  return isTokenAmountValid && isTokenTypeValid;
};

export const isNodeStakingNeeded = (product: Product): boolean => {
  const isTokenTypeValid = !!(
    product.reward.tokens?.node && product.reward.tokens.node !== 'none'
  );
  const isTokenAmountValid = !!(
    typeof product.reward.stake?.node === 'number' &&
    product.reward.stake.node > 0
  );

  return isTokenAmountValid && isTokenTypeValid;
};

export const isRegistrationStaked = (device: Device): boolean => {
  if (device.registration && device.registration.amount !== 0) {
    return true;
  }

  return false;
};

export const isNodeProduct = (product: Product): boolean => {
  return product.name.includes('Node') || product.name.includes('Edge');
};

export const isNodeStaked = (device: Device): boolean => {
  if (device.node && device.node.amount !== 0) {
    return true;
  }

  return false;
};

export const anchorIdForMinerKey = (minerKey: string): string => {
  const normalized = String(minerKey ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `device-${normalized || 'unknown'}`;
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
    // Prefer the live rewards sender vault (derived from REWARD_MNEMONIC),
    // fall back to the static constant for client-side contexts.
    const vaultAddr = getRewardsVaultAddress();
    const normalizedTarget = normalizeAssetId(assetId);

    try {
      // First, ask Algod for the specific holding. This avoids issues where the
      // generic accountInformation endpoint truncates the assets list.
      const holding = await algodClient
        .accountAssetInformation(vaultAddr, normalizedTarget)
        .do();

      const holdingAmount =
        (holding?.['asset-holding']?.amount ?? holding?.assetHolding?.amount ??
          0) as number | string | bigint;
      if (holdingAmount) {
        return Number(holdingAmount) / Math.pow(10, 6);
      }
      // If the asset is present but empty, we can return early.
      if (holding?.['asset-holding'] || holding?.assetHolding) {
        return 0;
      }
    } catch (assetErr: unknown) {
      // 404 means the asset isn't held; log at debug level and fall back below.
      const message =
        assetErr && typeof assetErr === 'object' && 'message' in assetErr
          ? (assetErr as { message: string }).message
          : String(assetErr ?? 'unknown error');
      console.debug('[getFRYAssetBalances] accountAssetInformation miss', {
        vaultAddr,
        assetId: normalizedTarget,
        message
      });
    }

    const accountInfo = await algodClient.accountInformation(vaultAddr).do();

    const assets = (accountInfo.assets ?? []) as Array<{
      ['asset-id']?: number | string | bigint;
      assetId?: number | string | bigint;
      asset_id?: number | string | bigint;
      amount?: number | string | bigint;
    }>;
    if (!assets.length) {
      console.warn('[getFRYAssetBalances] account has empty assets list', {
        vaultAddr,
        assetId: normalizedTarget
      });
    }
    const asset = assets.find((a) => {
      const candidate =
        a['asset-id'] ?? a.assetId ?? (a as Record<string, unknown>)?.asset_id ??
        null;
      return normalizeAssetId(candidate) === normalizedTarget;
    });

    if (asset) {
      return Number(asset.amount) / Math.pow(10, 6);
    }

    console.warn('[getFRYAssetBalances] asset not found in accountInformation', {
      vaultAddr,
      assetId: normalizedTarget,
      assetSample: assets.slice(0, 5).map((entry) => ({
        id: normalizeAssetId(entry['asset-id']),
        amount: entry.amount
      }))
    });

    try {
      const indexerAccount = await indexerClient
        .lookupAccountByID(vaultAddr)
        .includeAll(true)
        .do();
      const idxAssets = (indexerAccount?.account?.assets ?? []) as Array<{
        ['asset-id']?: number | string | bigint;
        assetId?: number | string | bigint;
        asset_id?: number | string | bigint;
        amount?: number | string | bigint;
      }>;
      const idxAsset = idxAssets.find((a) => {
        const candidate =
          a['asset-id'] ?? a.assetId ??
          (a as Record<string, unknown>)?.asset_id ?? null;
        return normalizeAssetId(candidate) === normalizedTarget;
      });

      if (idxAsset) {
        const amount = Number(idxAsset.amount ?? 0) / Math.pow(10, 6);
        console.debug('[getFRYAssetBalances] indexer fallback resolved balance', {
          vaultAddr,
          assetId: normalizedTarget,
          amount
        });
        return amount;
      }

      console.warn('[getFRYAssetBalances] indexer fallback did not find asset', {
        vaultAddr,
        assetId: normalizedTarget,
        idxAssetSample: idxAssets.slice(0, 5).map((entry) => ({
          id: normalizeAssetId(
            entry['asset-id'] ?? entry.assetId ??
            (entry as Record<string, unknown>)?.asset_id ?? null
          ),
          amount: entry.amount
        }))
      });
    } catch (indexErr) {
      console.error('[getFRYAssetBalances] indexer fallback failed', {
        vaultAddr,
        assetId: normalizedTarget,
        error:
          indexErr && typeof indexErr === 'object' && 'message' in indexErr
            ? (indexErr as { message: string }).message
            : String(indexErr ?? 'unknown error')
      });
    }
    return 0;
  } catch (err) {
    console.error('Error fetching balance:', err);
    return 0;
  }
};

/**
 * Returns the on-chain address of the rewards vault used by server-side senders.
 * If REWARD_MNEMONIC is present, derive the address to avoid mismatches when
 * vault keys rotate. Falls back to the static constant for browser contexts.
 */
export const getRewardsVaultAddress = (): string => {
  try {
    // Highest priority: explicit configured address
    const configured = process.env.REWARDS_VAULT_ADDR as string | undefined;
    if (configured && configured.trim().length > 0) {
      return configured.trim();
    }

    const m = process.env.REWARD_MNEMONIC as string | undefined;
    if (m && m.length > 0) {
      const acc = algosdk.mnemonicToSecretKey(m);
      // Always return a primitive string regardless of SDK Address typing.
      return String(acc.addr);
    }
  } catch (e) {
    // ignore and fall back
  }
  return REWALD_WALLET;
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
  } else if (assetId === tFRY.id) {
    return 'tFry';
  } else if (assetId === fVPN.id) {
    return 'fvpn';
  }
};

/**
 * Returns display string combining friendly name and id, e.g. "fnode (2485202024)".
 */
export const getAssetDisplay = (assetId: string) => {
  const name = getAssetName(assetId);
  return name ? `${name} (${assetId})` : assetId;
};

/**
 * Whether Boost (Instant Claim) is supported for the given asset.
 * Matches existing backend constraints: FRY 1.0, fNODE, fVPN; excludes FRY 2.0.
 */
export const isBoostAssetSupported = (assetId: string): boolean => {
  return assetId === FRY_1.id || assetId === fNODE.id || assetId === fVPN.id;
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
  device: Device,
  productParam?: Product
): Promise<{ [key: string]: string } | undefined> => {
  try {
    const deviceStatus: { [key: string]: string } = {};
    // Prefer provided product to avoid extra network calls
    let product: Product | undefined = productParam;
    if (!product) {
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
      product = productResult.data[0] as Product;
    }
    return computeDeviceStatus(device, product);
  } catch (error) {
    console.error('Device Status: ' + error);
    return undefined;
  }

  return undefined;
};

export const computeDeviceStatus = (
  device: Device,
  product?: Product
): { [key: string]: string } | undefined => {
  const deviceStatus: { [key: string]: string } = {};
  let isError = false;

  if (!device.position) {
    deviceStatus.position = 'Not set';
    isError = true;
  }

  if (!device.reward_wallet) {
    deviceStatus.reward_wallet = 'Not set';
    isError = true;
  }

  // Basic profile requirements – show device alerts when contact info is missing.
  if (!device.email || device.email.trim().length === 0) {
    deviceStatus.email = 'Email not set';
    isError = true;
  }

  const firstName = device.names?.first_name?.trim();
  const lastName = device.names?.last_name?.trim();
  if (!firstName) {
    deviceStatus.first_name = 'First name not set';
    isError = true;
  }
  if (!lastName) {
    deviceStatus.last_name = 'Last name not set';
    isError = true;
  }
  
  // Connectivity wallet check intentionally removed

  if (product && isRegistrationNeeded(product)) {
    if (!device.registration) {
      deviceStatus.registration = 'Not staked for registration';
      isError = true;
    } else if (device.registration.asset_id !== product.reward.tokens?.register) {
      deviceStatus.registration =
        'Registration staking information is changed. Please check and stake again';
      isError = true;
    } else if (device.registration.amount === 0) {
      deviceStatus.registration = 'Not staked for registration';
      isError = true;
    }
  }

  if (product && isNodeStakingNeeded(product)) {
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
};

export const getTransactionTime = async (
  txId: string | undefined,
  opts?: { retries?: number; delayMs?: number }
): Promise<Date> => {
  const retries = opts?.retries ?? 3;
  const delayMs = opts?.delayMs ?? 1000;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  if (!txId) return new Date();

  for (let i = 0; i < retries; i++) {
    try {
      const txInfo = await indexerClient.lookupTransactionByID(txId).do();
      if (txInfo.transaction && txInfo.transaction['round-time']) {
        return new Date(txInfo.transaction['round-time'] * 1000);
      }
    } catch (error: any) {
      const status = error?.status || error?.response?.status;
      // 404 is common while indexer is catching up; avoid noisy logs unless verbose enabled
      if (status !== 404 && process.env.NEXT_PUBLIC_VERBOSE_INDEXER_LOGS === 'true') {
        console.error('getTransactionTime:', error);
      }
    }
    if (i < retries - 1) await sleep(delayMs);
  }
  return new Date();
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
    const signerAddr = account.addr.toString();
    const txnsToBeSigned = txGroups.flatMap((txGroup) =>
      txGroup.filter((item) => item.signers?.includes(signerAddr))
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
    const initiatorAddr = account.addr.toString();
    const pool = await poolUtils.v2.getPoolInfo({
      network: 'mainnet' as SupportedNetwork,
      client: tinymanAlgodClient,
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
      client: tinymanAlgodClient,
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
            client: tinymanAlgodClient,
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
      client: tinymanAlgodClient,
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
