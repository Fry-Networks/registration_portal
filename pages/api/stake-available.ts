import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import clientPromise from "../../lib/mongoclient";
import { loggers } from "../../lib/logger";
import { Device } from "../../lib/types";
import {
    CommonErrors,
    createApiError,
    ErrorCodes,
    handleApiError,
} from "../../lib/api-errors";

const ENDPOINT = '/api/stake-available';
export default async function handler(req: NextApiRequest, res: NextApiResponse) {

    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json(
            createApiError(
                ErrorCodes.INVALID_INPUT,
                'Unsupported request method',
                'Use POST to check stake availability.'
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

    const { address, miner_key } = (req.body ?? {}) as {
        address?: string;
        miner_key?: string;
    };

    if (session.user.address !== address || !address) {
        loggers.apiError(ENDPOINT, new Error('Wallet mismatch checking stake availability'), {
            sessionAddress: session.user.address,
            address,
            miner_key,
            issueType: 'STAKE_AVAILABLE_WALLET_MISMATCH',
            part: 'stake-available.auth',
        });
        res.status(401).json(CommonErrors.walletMismatch());
        return;
    }
    if (!miner_key) {
        res.status(400).json(
            createApiError(
                ErrorCodes.INVALID_INPUT,
                'Miner key is required',
                'Please provide the miner key.'
            )
        );
        return;
    }
    try {
        const client = await clientPromise;
        const db = client.db('main');
        const collection = db.collection('devices');
        const device = (await collection.findOne({ miner_key })) as unknown as Device
        if (!device) {
            res.status(404).json(CommonErrors.deviceNotFound());
            return;
        }
        if(!device.staked) {
            res.status(400).json(
                createApiError(
                    ErrorCodes.NO_STAKE_FOUND,
                    'No stake record found for this device',
                    'Stake funds before checking availability.'
                )
            );
            return;
        }
        if(device.staked?.amount == 0) {
            res.status(400).json(
                createApiError(
                    ErrorCodes.ZERO_STAKE_AMOUNT,
                    'Stake amount is zero',
                    'Please verify the staking transaction and try again.'
                )
            );
            return;
        }
        const dayCheck = (Date.now() - new Date(device.staked.time).getTime())  / (1000 * 60 * 60 * 24) > 1;
        const sixMonthsCheck = (Date.now() - new Date(device.staked.time).getTime())  / (1000 * 60 * 60 * 24) > 180;
        
        const data = {
            available: device.staked.type == "one"  ? dayCheck : sixMonthsCheck,
            availableIn: device.staked.type == "one" ? 1 - (Date.now() - new Date(device.staked.time).getTime())  / (1000 * 60 * 60 * 24) : 180 - (Date.now() - new Date(device.staked.time).getTime())  / (1000 * 60 * 60 * 24)
        }

        res.status(200).json({ message: "ok", data });
    } catch (error) {
        handleApiError(res, ENDPOINT, error, {
            response: createApiError(
                ErrorCodes.INTERNAL_ERROR,
                'Failed to compute stake availability',
                'Please try again. If the issue persists, contact support.'
            ),
            minerKey: miner_key,
            walletAddress: address,
            issueType: 'STAKE_AVAILABLE_ERROR',
            part: 'stake-available.handler',
            metadata: {
                miner_key,
                address,
            },
        });
    }
};
