import { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth/[...nextauth]';
import clientPromise from '../../lib/mongoclient';
import { loggers } from '../../lib/logger';
import { generateMinerKey } from '../../lib/minerKey';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../lib/api-errors';
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );
  }

  const testMode =
    process.env.NEXT_PUBLIC_TEST_MODE &&
    process.env.NEXT_PUBLIC_TEST_MODE === 'true';

  const session = await getServerSession(req, res, authOptions);
  // Check if user is authenticated
  if (!session || !session.user?.address) {
    loggers.apiError('/api/convert-byod', new Error('Unauthenticated request'), {
      issueType: 'BYOD_CONVERSION_UNAUTHENTICATED',
      part: 'convert-byod.auth',
    });
    return res.status(401).json(CommonErrors.noSession());
  }

  const data: {
    address: string;
    byod: string;
    key: string;
  } = req.body;

  const { address, byod, key } = data;
  if (session.user.address !== address || !address) {
    loggers.apiError('/api/convert-byod', new Error('Wallet mismatch during BYOD conversion'), {
      sessionAddress: session.user.address,
      address,
      issueType: 'BYOD_CONVERSION_WALLET_MISMATCH',
      part: 'convert-byod.auth',
    });
    return res.status(401).json(CommonErrors.walletMismatch());
  }
  if (['SDN', 'RDN', 'SVN'].includes(key)) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'This product key is not eligible for BYOD conversion',
        'Please choose a supported product.'
      )
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('byods');
    const license = (
      await collection
        .find({
          'licenses.license': byod
        })
        .toArray()
    )[0];
    if (!license) {
      return res.status(404).json(
        createApiError(
          ErrorCodes.LICENSE_NOT_FOUND,
          'License not found',
          'Please verify the BYOD code and try again.'
        )
      );
    }
    const productsCollection = db.collection('products');
    const products = await productsCollection.find({}).toArray();
  const data = products.map((product) => {
    return { name: product.name, key: product.key };
  });
  // Allowlist BYOD-convertible products (must match docs/products.md names exactly).
  const allowedNames = new Set([
    '$FRY Bandwidth Miner',
    '$FRY Indoor Decibel Miner',
    '$FRY Outdoor Decibel Miner',
    '$FRY Indoor Satellite Miner',
    '$FRY Outdoor Satellite Miner',
    '$FRY Fry Edge Miner',
    '$FRY Energy Miner',
    '$FRY Indoor Radiation Miner',
    '$FRY Outdoor Low-End Water Quality Miner',
    '$FRY Outdoor High-End Water Quality Miner',
    '$FRY High-End Weather Miner',
    '$FRY Low-End Weather Miner',
    '$FRY AI Outdoor Wildlife Camera Miner',
    '$FRY AI Outdoor Traffic Camera Miner',
    '$FRY AI Outdoor Weather Station Camera Miner',
    '$FRY AI Indoor Wildlife Camera Miner',
    '$FRY AI Indoor Weather Station Camera Miner',
    '$FRY AI Indoor Sky Camera Miner',
    '$FRY AI Outdoor Sky Camera Miner',
    '$FRY AI Indoor Traffic Camera Miner',
    '$FRY Outdoor High-End Air Quality Miner',
    '$FRY Outdoor Mid-End Air Quality Miner',
    '$FRY Indoor High-End Air Quality Miner',
    '$FRY Indoor Mid-End Air Quality Miner',
    '$FRY Indoor Low-End Air Quality Miner'
  ]);
  const allowedProduct = data.find(
    (product) => product.key === key && allowedNames.has(product.name)
  );
  if (!allowedProduct) {
    return res.status(404).json(
      createApiError(
        ErrorCodes.PRODUCT_NOT_FOUND,
        'Product not found',
        'Please select a valid product for conversion.'
      )
    );
  }
  const product = allowedProduct;
    const devicesCollection = db.collection(
      testMode ? 'test-devices' : 'devices'
    );
    const byodAlreadyUsed = await devicesCollection.findOne({ byod: byod });
    if (byodAlreadyUsed) {
      const sameProduct =
        byodAlreadyUsed.name === product.name ||
        (typeof byodAlreadyUsed.miner_key === 'string' &&
          byodAlreadyUsed.miner_key.startsWith(`${key}-`));
      // Allow users to re-fetch the miner key if they previously converted but have not completed onboarding yet.
      if (!byodAlreadyUsed.is_registered && sameProduct && byodAlreadyUsed.miner_key) {
        return res.status(200).json({ message: 'ok', miner_key: byodAlreadyUsed.miner_key, existing: true });
      }
      return res.status(400).json(
        createApiError(
          ErrorCodes.ALREADY_REGISTERED,
          'This BYOD license has already been used',
          'Please contact support if you believe this is incorrect.'
        )
      );
    }
    // Use the shared generator so BYOD conversions follow the same key format and entropy as new issuances.
    let minerkey = generateMinerKey(key);
    while (await devicesCollection.findOne({ miner_key: minerkey })) {
      minerkey = generateMinerKey(key);
    }
    await devicesCollection.insertOne({
      miner_key: minerkey,
      created_at: new Date(),
      email: license.email,
      name: product.name,
      byod: byod,
      is_registered: false
    });

    res.status(200).json({ message: 'ok', miner_key: minerkey });
  } catch (error) {
    handleApiError(res, '/api/convert-byod', error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Unable to convert BYOD license',
        'Please try again. If the problem persists, contact support.'
      ),
      walletAddress: address,
      issueType: 'BYOD_CONVERSION_ERROR',
      part: 'convert-byod.handler',
      metadata: {
        address,
        byod,
        key,
      },
    });
  }
}
