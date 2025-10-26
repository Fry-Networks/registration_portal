import { NextApiRequest, NextApiResponse } from 'next';
import algosdk, { waitForConfirmation } from 'algosdk';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';

// Algorand client setup
const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
const tokenToSend = { 'X-API-Key': token };
const port = 443;
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const ENDPOINT = '/api/algorand/send-txn';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const walletAddress = session.user.address;

  const {
    asset_id,
    to,
    amount,
    note,
    staking,
  } = (req.body ?? {}) as {
    asset_id?: string;
    to?: string;
    amount?: number;
    note?: string;
    staking?: boolean;
  };

  if (
    !asset_id ||
    !to ||
    typeof amount !== 'number' ||
    Number.isNaN(amount) ||
    !note ||
    typeof note !== 'string'
  ) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing transaction parameters',
        'Please include asset id, destination, amount, and note.'
      )
    );
    return;
  }

  if (amount <= 0) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Transaction amount must be greater than zero',
        'Adjust the amount and try again.'
      )
    );
    return;
  }

  try {
    // Convert mnemonic to secret key
    const account = algosdk.mnemonicToSecretKey(
      staking
        ? process.env.NEXT_PUBLIC_ALGORAND_DEV_MNEMONIC!
        : process.env.STAKE_MNEMONIC!
    );
    const rekey = algosdk.mnemonicToSecretKey(process.env.STAKE_REKEY!);

    const from = account.addr.toString();
    const assetIndex: number = asset_id === 'none' ? 0 : Number(asset_id);

    // Fetch transaction parameters from the Algorand network
    const suggestedParams = await algodClient.getTransactionParams().do();

    const enc = new TextEncoder();
    const encodedNote = enc.encode(note);

    // Create a transaction to send FRY
    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      sender: from,
      receiver: to,
      amount: testMode ? 0 : amount * 1_000_000,
      assetIndex,
      note: encodedNote,
      suggestedParams
    });

    // Sign the transaction with the account secret key
    const signedTxn = txn.signTxn(staking ? account.sk : rekey.sk);

    // Send the signed transaction to the network
    const tx = await algodClient.sendRawTransaction(signedTxn).do();

    loggers.txnLog('algorand_send_txn', tx.txid, {
      asset_id,
      to,
      amount,
      staking,
      testMode,
    });

    return res.status(200).json({ txId: tx.txid });
  } catch (error) {
    handleApiError(res, ENDPOINT, error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to broadcast Algorand transaction',
        'Please try again.'
      ),
      walletAddress,
      issueType: 'ALGOD_SEND_TXN_ERROR',
      part: 'algorand.send-txn.handler',
      metadata: {
        asset_id,
        to,
        amount,
        staking,
      },
    });
    return;
  }
}
