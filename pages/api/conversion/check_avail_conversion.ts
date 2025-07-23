import { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import algosdk from 'algosdk';
import { getServerSession } from 'next-auth';

import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { FRY_1, FC_CHECKED, FC_UNCHECKED, FC_STARTED } from '../../../lib/utils';

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
    isLoading: boolean;
  } = req.body;

  const { address, isLoading } = data;
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
    if (user) {
      if (isLoading) {
        if (user.status === 'valid') {
          res.status(200).json({ success: true, message: 'Already Checked The Availability For FRY1.0 Conversion.', data: user, isChecked: FC_CHECKED });
          return;
        } else if ( user.status === 'pending') {
          res.status(200).json({ success: true, message: 'Already Started The FRY1.0 Conversion.', data: user, isChecked: FC_STARTED });
          return;
        } else {
          res.status(200).json({ message: 'Still Not Check Availability For Conversion.', isChecked: FC_UNCHECKED });
          return;
        }
      }

      if (user['amount'] === 0) {
        res.status(401).json({ message: 'The Empty Balance For Conversion.' });
        return;
      
      } else {
        const updateResult = await collection.updateOne(
          { address },
          {
            $set: {
              status : 'valid',
              asset_id : FRY_1.id,
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
            message: `Failed to set checking available for account ${address}.`
          });
          return;
        }
      }
      res.status(200).json({ success: true, message: 'Successfully Checked Availability For FRY1.0 Conversion!', data: user});
      return;
    }

    res.status(402).json({ success: false, message: 'Invalid Account For FRY1.0 Conversion' });
    return;
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'error' });
  }
}
