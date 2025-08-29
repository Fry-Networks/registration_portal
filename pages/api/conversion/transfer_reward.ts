import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import algosdk, { mnemonicToSecretKey, waitForConfirmation } from 'algosdk';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { verifyTransaction } from '../algorand/verify-txn';
import { VERIFY_RESULT } from '../../../lib/txn';
import { FRY_2, fNODE, getFRYAssetBalances } from '../../../lib/utils';

const testMode =
  process.env.NEXT_PUBLIC_TEST_MODE &&
  process.env.NEXT_PUBLIC_TEST_MODE === 'true';

const token = '';
const server = 'https://xna-mainnet-api.algonode.cloud/';
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
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    convertType: string;
  } = req.body;

  const { address, convertType } = data;
  if (session.user.address !== address || !address) {
    console.log(
      `Fry_Conversion session.user.address: ${session.user.address}, address: ${address} SPOOF`
    );
    res.status(401).json({ message: 'Unauthorized 2' });
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('fry-conversions');
    const user = await collection.findOne({ address });
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Not Existed Account For Conversion.'
      });
      return;
    }

    const assetId = convertType === FRY_2.id ? FRY_2.id : fNODE.id;

    const vaultBalance = await getFRYAssetBalances(assetId);
    if (vaultBalance < user.claimableAmount) {
      res.status(402).json({
        message: `Conversion failed: Insufficient funds available in the rewards vault to process your claim. Vault Balance: ${vaultBalance}, Your Claimable Amount: ${(user.claimableAmount).toFixed(5)} Please contact support to resolve this.`
      });
      return;
    }

    const accountInfo = await algodClient.accountInformation(address).do();
    const isOptedIn = accountInfo.assets.some((a) => a['asset-id'] === parseInt(assetId));

    if (!isOptedIn) {
      res.status(402).json({
        message: `Please opt-in the ${convertType === FRY_2.id ? 'FRY2.0' :'fNODE'} asset to your account.`
      });
      return;
    }

    const t = convertType === FRY_2.id
        ? user.claimableAmount * (user?.ratio ? user.ratio[0] : 80)
        : user.claimableAmount * (user?.ratio ? user.ratio[1] : 40); 

    const updateResult = await collection.updateOne(
      { address },
      {
        $set: {
          claimableAmount: 0,
          claimedMonths: user.claimableMonths + user.claimedMonths,
          claimableMonths: 0,
          pendingAmount: user.pendingAmount - t,
        },
        $push: {
          history: {
            amount: user.claimableAmount,
            tokenType: convertType === FRY_2.id ? 'FRY 2.0' : 'fNODE',
            date: new Date()
          }
        }
      }
    );

    let success = true;
    if (updateResult.matchedCount <= 0) {
      success = false;
    }

    if (success === false) {
      res.status(401).json({
        success: false,
        message: `Failed to add the rewards for account ${address}.`
      });
      return;
    }

    const suggestedParams = await algodClient.getTransactionParams().do();
    const account = mnemonicToSecretKey(process.env.REWARD_MNEMONIC!);
    const rekey = mnemonicToSecretKey(process.env.REWARD_REKEY!);

    const from = account.addr;

    const noteInfo = {
      title: 'FRY 1.0 Conversion',
      asset_id: convertType === FRY_2.id ? FRY_2.id : fNODE.id,
      amount: user.claimableAmount,
      date: new Date(Date.now())
    };

    const enc = new TextEncoder();
    const note = enc.encode(JSON.stringify(noteInfo));

    const decimals = FRY_2.decimals;
    const amount = user.claimableAmount;

    const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
      from,
      to: address,
      amount: testMode ? 0 : BigInt(Math.floor(amount * Math.pow(10, decimals || 0))),
      assetIndex: Number(convertType === FRY_2.id ? FRY_2.id : fNODE.id),
      note,
      suggestedParams,
    });

    const signedTxn = txn.signTxn(rekey.sk);
    const tx = await algodClient.sendRawTransaction(signedTxn).do();
    if (!tx) {
      res.status(402).json({
        message: 'Failed to make claiming transaction for conversion'
      });
      return;
    }

    const result = await verifyTransaction(account.addr, tx.txId);
    if (result !== VERIFY_RESULT.OK) {
      res
        .status(402)
        .json({ message: 'Failed to make verify claim transaction' });
      return;
    }

    return res.status(200).json({
      success: true,
      message: `You’ve received "${user.claimableMonths}/12" month’s ${convertType === FRY_2.id ? 'FRY 2.0' : 'fNODE'} from your vesting schedule. Check back next month for your next claim!`,
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}
