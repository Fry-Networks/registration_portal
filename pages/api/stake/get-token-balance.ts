import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const port = 443;
import {
  Algodv2,
  Indexer,
  makeAssetTransferTxnWithSuggestedParamsFromObject,
  mnemonicToSecretKey,
  Account
} from 'algosdk';
import { getSession } from 'next-auth/react';
const tokenToSend = {
  'X-API-Key': token
};
const client = new Algodv2(tokenToSend, server, port);
const indexServer = 'https://mainnet-idx.algonode.cloud/';
const indexer = new Indexer(tokenToSend, indexServer, port);

// Function to fetch asset decimals
const getAssetDecimals = async (assetId: number): Promise<number | null> => {
  try {
    const assetInfo = await indexer.lookupAssetByID(assetId).do();
    const decimals = assetInfo.asset.params.decimals;
    console.log(`Asset ID: ${assetId}, Decimals: ${decimals}`);
    return decimals;
  } catch (error) {
    console.error(`Failed to fetch asset info for Asset ID ${assetId}:`, error);
    return null;
  }
};

export async function getTokenBalance(
  address: string,
  assetId: string
): Promise<number | null> {
  try {
    // Fetch account information
    const accountInfo = await client.accountInformation(address).do();
    const correctAssetId = assetId === 'none' ? 0 : Number(assetId);

    // Find the asset in the account's assets list
    const asset = accountInfo.assets.find((asset: any) => {
      return asset['asset-id'] === correctAssetId;
    });

    if (asset) {
      // Return the asset balance (converted to base units, if needed)
      console.log(asset);
      const decimals = await getAssetDecimals(asset['asset-id']);
      return asset.amount / Math.pow(10, decimals || 0); // Adjust for decimals
    } else {
      console.log(`Asset ID ${correctAssetId} not found for this account.`);
      return null;
    }
  } catch (error) {
    console.error('Error fetching account information:', error);
    return null;
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user) {
    console.log(`no session`);
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { address, asset_id } = req.body;

  if (!address || !asset_id) {
    res.status(400).json({ message: 'Invalid input param' });
    return;
  }

  const tokenAmountInWallet = await getTokenBalance(address, asset_id);
  console.log(tokenAmountInWallet);

  if (!tokenAmountInWallet) {
    res
      .status(200)
      .json({ success: false, message: 'No asset_id opted-in the wallet' });
  } else {
    res.status(200).json({ success: true, balance: tokenAmountInWallet });
  }
}
