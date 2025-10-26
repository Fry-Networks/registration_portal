import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import algosdk from "algosdk";
import clientPromise from "../../lib/mongoclient";
import { loggers } from '../../lib/logger';
import mongoose from "mongoose";
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../lib/api-errors';
const algodClient = new algosdk.Algodv2(
    "",
    "https://mainnet-api.algonode.cloud",
    ""
);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const ENDPOINT = '/api/verify-stake';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        res.status(405).json(
            createApiError(
                ErrorCodes.INVALID_INPUT,
                'Unsupported request method',
                'Submit stake verification using POST.'
            )
        );
        return;
    }

    const session = await getServerSession(req, res, authOptions);
    if (!session || !session.user?.address) {
        res.status(401).json(CommonErrors.noSession());
        return;
    }

    const walletAddress = session.user.address.trim();

    const { miner, txId, address, type } = (req.body ?? {}) as {
        txId?: string,
        address?: string,
        miner?: string,
        type?: string
    };

    if (!miner || !txId || !address || !type) {
        res.status(400).json(
            createApiError(
                ErrorCodes.INVALID_INPUT,
                'Missing required stake verification data',
                'Please include miner key, wallet address, transaction id, and stake type.'
            )
        );
        return;
    }

    try {
        if (walletAddress !== address) {
            loggers.apiError(ENDPOINT, new Error('Wallet mismatch during stake verification'), {
                miner_key: miner,
                address,
                sessionAddress: walletAddress,
                issueType: 'VERIFICATION_STAKE_WALLET_MISMATCH',
                part: 'verify-stake.auth',
            });
            res.status(401).json(CommonErrors.walletMismatch());
            return;
        }
        const client = await clientPromise;
        const db = client.db('main');
        const product = await db.collection('products').findOne({ key: miner.split("-")[0] }) as Product
        if (!product) {
            loggers.apiError(ENDPOINT, new Error('Product not found for stake verification'), {
                miner_key: miner,
                address,
                issueType: 'VERIFICATION_STAKE_PRODUCT_MISSING',
                part: 'verify-stake.lookup.product',
            });
            res.status(404).json(CommonErrors.productNotFound());
            return;
        }
        /*let price = await getFRYPrice();
        if (!price) return 1;
        const USD = product.reward.stake ?? 0;
        //price = Math.floor((USD / price)) * (process.env.NODE_ENV === 'development' ? 1 : 1000000)
        const FRYamount = Math.floor((USD / price))
        */
        if (!product.reward.stake) {
            loggers.apiError(ENDPOINT, new Error('Stake configuration missing'), {
                miner_key: miner,
                address,
                issueType: 'VERIFICATION_STAKE_CONFIG_MISSING',
                part: 'verify-stake.lookup.stakeConfig',
            });
            res.status(400).json(
                createApiError(
                    ErrorCodes.ZERO_STAKE_AMOUNT,
                    'Stake configuration missing for this product',
                    'Contact support to review the product configuration.'
                )
            );
            return;
        }
        const stake_amt = (type === "one" ? product.reward.stake.stake_one : product.reward.stake.stake_two) ?? 0

        const miner_data = await db.collection('devices').findOne({ miner_key: miner })
        if (!miner_data) {
            res.status(404).json(CommonErrors.deviceNotFound());
            return;
        }
        if (miner_data.verified) {
            res.status(400).json(
                createApiError(
                    ErrorCodes.ALREADY_STAKED,
                    'This device is already verified',
                    'No additional stake verification is required.'
                )
            );
            return;
        }
        const FRYamount = miner_data.byod ? stake_amt / 2 : stake_amt;
        if (FRYamount === 0) {
            res.status(400).json(
                createApiError(
                    ErrorCodes.ZERO_STAKE_AMOUNT,
                    'Stake amount must be greater than zero',
                    'Contact support to review the device configuration.'
                )
            );
            return
        }
        let price = FRYamount * 1_000_000;
        const result = await confirmTransaction(miner, txId, price);
        if (result.code !== 0) {
            loggers.apiError(ENDPOINT, new Error('Stake verification transaction failed'), {
                miner_key: miner,
                address,
                txId,
                issueType: 'VERIFICATION_STAKE_VALIDATION_FAILED',
                part: 'verify-stake.transaction.validate',
                failureCode: result.code,
                expectedAmountMicro: price,
                actualAmountMicro: result.amount,
                reason: result.reason,
            });

            const failureResponse = buildVerificationFailureResponse(result, price);
            res.status(failureResponse.status).json(failureResponse.body);
            return;
        }

        const collection = db.collection('devices');
        await collection.updateOne(
            { miner_key: miner, address: session.user.address },
            {
                $set: {
                    verified: true,
                    staked: {
                        type: type,
                        amount: FRYamount,
                        txId,
                        time: new Date(Date.now()),
                        rewarded_time: new Date(Date.now())
                    }
                }

            }
        );

        loggers.stakeOperation('verification_complete', miner, {
            address,
            txId,
            amount: FRYamount,
            type,
        });

        res.status(200).json({ message: "ok" });
    } catch (error) {
        handleApiError(res, ENDPOINT, error, {
            response: createApiError(
                ErrorCodes.INTERNAL_ERROR,
                'Failed to verify stake transaction',
                'Please try again. If the problem persists, contact support.',
                { errorId: `${miner}-${Date.now()}` }
            ),
            minerKey: miner,
            walletAddress,
            issueType: 'VERIFICATION_STAKE_ERROR',
            part: 'verify-stake.handler',
            metadata: {
                miner_key: miner,
                address,
                txId,
                type,
            },
        });
    }
};

const fryReceiver = 'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';

type VerificationResult =
    | { code: 0; amount: number; reason?: undefined }
    | { code: 2 | 3 | 4; amount?: number; reason?: string };

async function confirmTransaction(minerKey: string, txId: string, price: number): Promise<VerificationResult> {
    loggers.txnLog('verify_stake_confirm_start', txId, {
        miner_key: minerKey,
        expectedAmount: price,
    });
    let amount;
    try {

        const lowerBound = price - (price * 0.05); // lower bound is 95% of the price
        const upperBound = price + (price * 0.05); // upper bound is 105% of the price

        // Get the confirmed transaction
        await wait(2000)
        const confirmedTxn = await algodClient.pendingTransactionInformation(txId).do();
        const txn = confirmedTxn?.txn?.txn;
        if (!txn) {
            return { code: 4, reason: 'PENDING_INFO_MISSING' };
        }
        // Check if the receiver is correct
        const actualReceiverField = 'arcv';
        const actualReceiver = algosdk.encodeAddress(txn[actualReceiverField]);
        const receiver = fryReceiver;
        if (actualReceiver !== receiver) {
            return { code: 2, reason: 'RECEIVER_MISMATCH' }
        }

        // Check if the amount is correct (assuming price is in MicroAlgos)
        const amountField = 'aamt';
        amount = txn[amountField] || 0; // Default to 0 if amt field is missing
        if (amount < lowerBound || amount > upperBound) {
            return { code: 3, amount, reason: 'AMOUNT_OUT_OF_RANGE' }
        }
    } catch (error) {
        loggers.apiError(`${ENDPOINT}#confirmTransaction`, error, {
            miner_key: minerKey,
            txId,
            expectedAmount: price,
            issueType: 'VERIFICATION_STAKE_CONFIRMATION_ERROR',
            part: 'verify-stake.confirmTransaction',
        });
        return { code: 4 }
    }
    return { code: 0, amount: amount ?? 0 };
}

function buildVerificationFailureResponse(
    result: VerificationResult,
    expectedAmount: number
): { status: number; body: ReturnType<typeof createApiError> } {
    switch (result.code) {
        case 2:
            return {
                status: 400,
                body: createApiError(
                    ErrorCodes.INVALID_TRANSACTION,
                    'The submitted transaction was sent to an unexpected recipient',
                    'Please submit the stake transaction that targets the official Fry staking wallet address.',
                    { receiver: fryReceiver }
                )
            };
        case 3:
            return {
                status: 400,
                body: createApiError(
                    ErrorCodes.AMOUNT_MISMATCH,
                    'Stake transaction amount does not match the required amount',
                    'Confirm the stake amount and resubmit the verification.',
                    {
                        expectedAmountMicro: expectedAmount,
                        actualAmountMicro: result.amount ?? null,
                    }
                )
            };
        default:
            return {
                status: 500,
                body: createApiError(
                    ErrorCodes.TRANSACTION_FAILED,
                    'Unable to verify the stake transaction on-chain',
                    'Please try again in a few minutes. If this continues, contact support.'
                )
            };
    }
}

export interface Product extends mongoose.Document {
    wix_id: string,
    name: string,
    key: string,
    reward: {
        unverified: number,
        verified: number,
        stake?: {
            stake_one: number,
            stake_two: number
        }
    },
    created_at: Date
}
