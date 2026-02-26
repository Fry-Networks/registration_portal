import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import clientPromise from "../../lib/mongoclient";
import { loggers } from "../../lib/logger";
import {
    CommonErrors,
    createApiError,
    ErrorCodes,
    handleApiError,
} from "../../lib/api-errors";

const ENDPOINT = '/api/get_miner_types';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {

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

    const { address } = (req.body ?? {}) as { address?: string };
    if (!address || session.user.address !== address) {
        loggers.apiError(ENDPOINT, new Error('Wallet mismatch fetching miner types'), {
            sessionAddress: session.user.address,
            address,
            issueType: 'MINER_TYPES_WALLET_MISMATCH',
            part: 'get-mine-types.auth',
        });
        res.status(401).json(CommonErrors.walletMismatch());
        return;
    }
    try {
        const client = await clientPromise;
        const db = client.db('main');
        const collection = db.collection('products');
        const products = await collection.find({}).toArray();
        const data = products.map(product => {
            return { name: product.name, key: product.key };
        });

        res.status(200).json({ message: "ok", data });
    } catch (error) {
        handleApiError(res, ENDPOINT, error, {
            response: createApiError(
                ErrorCodes.INTERNAL_ERROR,
                'Failed to load miner types',
                'Please try again or contact support.'
            ),
            walletAddress: address,
            issueType: 'MINER_TYPES_FETCH_ERROR',
            part: 'get-mine-types.handler',
            metadata: {
                address,
            },
        });
    }
};
