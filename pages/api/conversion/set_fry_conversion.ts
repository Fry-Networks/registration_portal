import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { indexerClient, BURN_WALLET, FRY_1 } from '../../../lib/utils';

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
    res.status(401).json({ message: 'Unauthorized 1' });
    return;
  }

  const data: {
    address: string;
    id: string;
  } = req.body;

  const { address, id } = data;
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
      res.status(401).json({ success: false, message: 'Not Existed Account For Conversion.' });
      return;
    }

    if (user.amount === 0) {
      res.status(401).json({ success: false, message: 'Not Enough Balance For Conversion.' });
      return;
    }

    if (user.status === 'pending') {
      res.status(401).json({ success: false, message: 'Already Started The Conversion.' });
      return;
    }

    const response = await indexerClient.lookupTransactionByID(id).do();
    const txn = response.transaction;
    if (txn['sender'] !== address) {
      res.status(401).json({ success: false, message: 'Unauthorized Transaction.' });
      return;
    }

    // Check if the transaction is an asset transfer
    if (!txn['asset-transfer-transaction']) {
      res.status(401).json({ success: false, message: 'Invalid Transaction Type.' });
      return;
    } else {
      const assetTransfer = txn['asset-transfer-transaction'];
      if (assetTransfer['receiver'] !== BURN_WALLET) {
        res.status(401).json({ success: false, message: 'Unauthorized Receiver.' });
        return;
      }

      const expectedAmount = testMode ? 0 : parseFloat(user.amount) * Math.pow(10, FRY_1.decimals);
      if (assetTransfer['amount'] !== expectedAmount) {
        res.status(401).json({ success: false, message: 'Invalid Transfer Amount.' });
        return;
      }
    }

    const updateResult = await collection.updateOne(
      { address },
      {
        $set: {
          status: 'pending',
          claimableAmount: 0,
          pendingAmount: user.amount,
          claimableMonths: 0,
          claimedMonths: 0,
        }
      }
    );

    let success = true;
    if (updateResult.matchedCount <= 0) {
      success = false;
    }

    if (success === false) {
      res.status(402).json({
        success: false,
        message: `Failed to set claiming for account ${address}.`
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Head back to the Fry 1.0 Conversion to start your claim process`
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}
