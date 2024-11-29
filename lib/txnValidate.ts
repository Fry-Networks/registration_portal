import algosdk, { Account, Indexer, Transaction } from 'algosdk';

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
  const enc = new TextEncoder();
  const params = await algodClient.getTransactionParams().do();
  const optInTxn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    from: fromAccount.addr,
    to: toAddress,
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

export default async (address: string, note: Uint8Array) => {
  console.log('[KING', address, note);
  const lastTxns = await indexer
    .lookupAccountTransactions(address)
    .limit(30)
    .do();

  console.log('[KING]', lastTxns);
  const fiveSecAgo = new Date(Date.now() - 5 * 1000);
  let transaction: Transaction;
  for (transaction of lastTxns.transactions) {
    const txnDate = new Date(transaction['round-time'] * 1000);

    if (txnDate < fiveSecAgo) continue;

    const tmpNote = transaction.note;
    if (tmpNote && tmpNote === note) {
      return true;
    }
  }

  return false;
};
