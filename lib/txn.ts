import algosdk from 'algosdk';
import HTTPClient from 'algosdk/dist/types/client/client';
import Error from 'next/error';

const devMode =
  process.env.NEXT_PUBLIC_DEV_MODE &&
  process.env.NEXT_PUBLIC_DEV_MODE === 'true';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

export enum SEND_TXN_RESULT {
  OK = 0,
  INVALID_PARAM,
  NO_ASSET,
  INSUFFICIENT_AMOUNT,
  INTERNAL_ERROR
}

export interface OutputSendTransaction {
  txId?: string;
  result: SEND_TXN_RESULT;
}
export async function sendAlgoTransaction(
  from: string,
  to: string,
  asset_id: string,
  amount: number,
  note: string,
  signTransactions?: any,
  sendTransactions?: any,
  staking?: boolean
): Promise<OutputSendTransaction> {
  console.log('Send Tranasction Function');
  console.log(from, to, asset_id, amount, note);

  let txId = '';
  if (!asset_id || asset_id === 'none' || asset_id.length <= 0 || amount < 0) {
    return { result: SEND_TXN_RESULT.INVALID_PARAM };
  }

  try {
    if (devMode) {
      const tokenBalanceResponse = await fetch(
        'api/algorand/get-token-balance',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            address: from,
            asset_id: asset_id
          })
        }
      );

      if (!tokenBalanceResponse.ok) {
        return { result: SEND_TXN_RESULT.INVALID_PARAM };
      }

      const tokenBalanceResult = await tokenBalanceResponse.json();
      if (tokenBalanceResult.success === false) {
        return { result: SEND_TXN_RESULT.NO_ASSET };
      }

      const amountInWallet = tokenBalanceResult.balance;
      if (!devMode && amountInWallet < amount) {
        return { result: SEND_TXN_RESULT.INSUFFICIENT_AMOUNT };
      }

      const response = await fetch('api/algorand/send-txn', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: from,
          to: to,
          asset_id: asset_id,
          amount: amount,
          note: note,
          staking
        })
      });

      const result = await response.json();
      if (!response.ok) {
        return { result: SEND_TXN_RESULT.INTERNAL_ERROR };
      }

      txId = result.txId;
    } else {
      const algodClient = new algosdk.Algodv2(
        '',
        'https://mainnet-api.algonode.cloud',
        ''
      );

      const suggestedParams = await algodClient.getTransactionParams().do();
      const enc = new TextEncoder();
      const encodedNote = enc.encode(note);

      const transaction =
        algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
          from,
          to,
          amount: testMode ? 0 : amount * 1_000_000, // Amount in microAlgos
          note: encodedNote,
          assetIndex: Number(asset_id === 'none' ? 0 : asset_id),
          suggestedParams
        });

      const encodedTransaction = algosdk.encodeUnsignedTransaction(transaction);
      const signedTransactions = await signTransactions([encodedTransaction]);

      const waitRoundsToConfirm = 4;
      const result = await sendTransactions(
        signedTransactions,
        waitRoundsToConfirm
      );

      txId = result.txId;
    }
  } catch (error) {
    console.error(error);
    return { result: SEND_TXN_RESULT.INVALID_PARAM };
  }

  return { txId: txId, result: SEND_TXN_RESULT.OK };
}

export enum VERIFY_RESULT {
  OK,
  INTERNAL_ERROR,
  FAILED
}

export async function confirmTransaction(
  address: string,
  txId: string
): Promise<VERIFY_RESULT> {
  try {
    const response = await fetch('api/algorand/verify-txn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        address: address,
        txId: txId
      })
    });

    if (!response.ok) {
      return VERIFY_RESULT.INTERNAL_ERROR;
    }

    const result = await response.json();
    if (!result.success) {
      return VERIFY_RESULT.FAILED;
    }
  } catch (error) {
    console.error(error);
    return VERIFY_RESULT.INTERNAL_ERROR;
  }
  return VERIFY_RESULT.OK;
}
