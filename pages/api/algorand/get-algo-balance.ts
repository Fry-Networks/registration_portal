import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const port = 443;
import { Algodv2 } from 'algosdk';

const tokenToSend = {
  'X-API-Key': token
};
const client = new Algodv2(tokenToSend, server, port);

export async function getTokenBalance(address: string): Promise<number | null> {
  try {
    // Fetch account information
    const accountInfo = await client.accountInformation(address).do();
    const balance = Number(accountInfo.amount) / 1e6; // Convert microAlgos to Algos

    // console.log(`Wallet Address: ${address}`);
    // console.log(`Algo Balance: ${balance} Algos`);
    return balance;
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
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  const { address } = req.body;

  if (!address) {
    res.status(400).json({ message: 'Invalid input param' });
    return;
  }

  const tokenAmountInWallet = await getTokenBalance(address);
  console.log(tokenAmountInWallet);

  if (!tokenAmountInWallet) {
    res
      .status(200)
      .json({ success: false, message: 'No asset_id opted-in the wallet' });
  } else {
    res
      .status(200)
      .json({ success: true, balance: tokenAmountInWallet.toFixed(3) });
  }
}
