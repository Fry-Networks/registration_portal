import { NextApiRequest, NextApiResponse } from 'next';
import algosdk, { waitForConfirmation } from 'algosdk';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';

// Algorand client setup
const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

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

  const data: {
    asset_id: string;
    from: string;
    to: string;
    amount: number;
    note: string;
    staking?: boolean;
  } = req.body;
  const { asset_id, from, to, amount, note, staking } = data;

  try {
    // Convert mnemonic to secret key
    const account = algosdk.mnemonicToSecretKey(
      staking
        ? process.env.NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC!
        : process.env.STAKE_MNEMONIC!
    );

    const from = account.addr.toString();
    const assetIndex: number = asset_id === 'none' ? 0 : Number(asset_id);

    // Fetch transaction parameters from the Algorand network
    const suggestedParams = await algodClient.getTransactionParams().do();

    console.log(note);
    const enc = new TextEncoder();
    const encodedNote = enc.encode(note);

    // Create a transaction to send FRY
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from,
      to,
      amount: testMode ? 0 : amount * 1_000_000,
      assetIndex,
      note: encodedNote,
      suggestedParams
    });

    // Sign the transaction with the account secret key
    const signedTxn = txn.signTxn(account.sk);

    // Send the signed transaction to the network
    const tx = await algodClient.sendRawTransaction(signedTxn).do();

    console.log('Transaction ID:', tx.txId);
    return res.status(200).json({ txId: tx.txId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ txId: null });
  }
}
