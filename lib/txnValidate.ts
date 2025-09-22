import algosdk, { Account, Indexer } from 'algosdk';
import type { indexerModels } from 'algosdk';

const token = '';
const tokenToSend = { 'X-API-Key': token };
const server = process.env.NEXT_PUBLIC_ALGOD_SERVER || '';
const port = 443;

const indexer = new Indexer(
  tokenToSend,
  'https://mainnet-idx.algonode.cloud/',
  443
);
const algodClient = new algosdk.Algodv2(tokenToSend, server, port);

export const optInForAsset = async (
  fromAccount: Account,
  toAddress: string,
  assetId: number
): Promise<void> => {
  const params = await algodClient.getTransactionParams().do();
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: fromAccount.addr,
    receiver: toAddress,
    amount: 0,
    assetIndex: assetId,
    suggestedParams: params,
    note: new Uint8Array(
      Buffer.from('Optimal For Asset' + Math.floor(Math.random() * 1000))
    )
  });
  const signedOptInTxn = optInTxn.signTxn(fromAccount.sk);
  await algodClient.sendRawTransaction(signedOptInTxn).do();
};

export const hasOptedInForAsset = async (
  address: string,
  assetId: number
): Promise<boolean> => {
  const accountInfo = await algodClient.accountInformation(address).do();
  const assets = accountInfo['assets'] || [];
  return assets.some((asset: any) => asset['asset-id'] === assetId);
};

export default async (address: string, note: Uint8Array): Promise<boolean> => {
  console.log('[KING', address, note);
  const lastTxns = (await indexer
    .lookupAccountTransactions(address)
    .limit(30)
    .do()) as indexerModels.TransactionsResponse;

  console.log('[KING]', lastTxns);
  const fiveSecAgo = new Date(Date.now() - 5 * 1000);
  const transactions = lastTxns.transactions ?? [];
  const targetNoteBase64 = Buffer.from(note).toString('base64');

  for (const transaction of transactions) {
    const roundTimeValue =
      (transaction as { roundTime?: number | bigint }).roundTime ??
      (transaction as { ['round-time']?: number | bigint })['round-time'];
    if (!roundTimeValue) continue;
    const txnDate = new Date(Number(roundTimeValue) * 1000);

    if (txnDate < fiveSecAgo) continue;

    const tmpNote = transaction.note as Uint8Array | string | undefined;
    if (!tmpNote) continue;

    const txnNoteBase64 =
      typeof tmpNote === 'string'
        ? tmpNote
        : Buffer.from(tmpNote).toString('base64');

    if (txnNoteBase64 === targetNoteBase64) {
      return true;
    }
  }

  return false;
};
