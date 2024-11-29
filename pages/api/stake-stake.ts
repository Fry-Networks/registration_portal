import { NextApiRequest, NextApiResponse } from 'next';
import algosdk, { waitForConfirmation } from 'algosdk';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import txnValidate, {
  hasOptedInForAsset,
  optInForAsset
} from '../../lib/txnValidate';

// Algorand client setup
const token = '';
const server = process.env.NEXT_PUBLIC_ALGOD_SERVER || '';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

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

  const data: { to: string; amount: number } = req.body;
  const { to, amount } = data;

  try {
    // Convert mnemonic to secret key
    const account = algosdk.mnemonicToSecretKey(
      process.env.NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC!
    );

    const from = account.addr.toString();
    const assetIndex: number = Number(process.env.NEXT_PUBLIC_ASSET_INDEX) || 0;

    // Fetch transaction parameters from the Algorand network
    const suggestedParams = await algodClient.getTransactionParams().do();

    const note = new Uint8Array(
      Buffer.from('Verification stake' + Math.floor(Math.random() * 1000))
    );

    if (
      (await hasOptedInForAsset(account.addr.toString(), assetIndex)) === false
    ) {
      await optInForAsset(account, account.addr.toString(), assetIndex);
    }

    // Create a transaction to send FRY
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from,
      to,
      amount: amount * 1_000_000,
      assetIndex,
      note,
      suggestedParams
    });

    // Sign the transaction with the account secret key
    const signedTxn = txn.signTxn(account.sk);

    // Send the signed transaction to the network
    const tx = await algodClient.sendRawTransaction(signedTxn).do();

    console.log('Transaction ID:', tx.txId);
    // if ((await txnValidate(from, note)) === false) {
    //   return res.status(500).json({ txId: null });
    // }

    return res.status(200).json({ txId: tx.txId });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ txId: null });
  }
}
