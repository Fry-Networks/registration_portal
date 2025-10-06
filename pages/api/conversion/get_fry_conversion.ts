import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { FRY_2, ALL_RELEASE_DATE, CORE_RELEASE_DATE, MODS_RELEASE_DATE } from '../../../lib/utils';
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

    const currentDateObj = new Date();
    // Use RELEASE_DATE for vesting schedule
    const vestingStart = user?.ratio ? (user.ratio[2] === 1 ? CORE_RELEASE_DATE : MODS_RELEASE_DATE) : ALL_RELEASE_DATE;
    const differenceInTime = currentDateObj.getTime() - vestingStart.getTime();
    const differenceInDays = Math.floor(
      differenceInTime / (1000 * 60 * 60 * 24)
    );

    // Only allow up to 12 months
    const monthsVested = Math.min(Math.floor(differenceInDays / 30), 11);
    if (monthsVested + 1 > user.claimedMonths) {
      const times = (monthsVested + 1) - user.claimedMonths;
      const src = (user.amount / 12) * times;
      const convertedAmount =
        convertType === FRY_2.id
          ? src / (user?.ratio ? user.ratio[0] : 80)
          : src / (user?.ratio ? user.ratio[1] : 40);

      const updateResult = await collection.updateOne(
        { address },
        {
          $set: {
            claimableMonths: times,
            claimableAmount: convertedAmount,
            isProcessing: false
          },
          $unset: {
            processingStartedAt: ''
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

      const updated = await collection.findOne({ address });
      res.status(200).json({
        success: true,
        message: `Started claiming for conversion successfully.`,
        user: updated 
      });
      return;
    }

    res.status(200).json({
      success: true,
      message: `Started claiming for conversion successfully.`,
      user // user object includes 'history' array if present in DB
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
}
