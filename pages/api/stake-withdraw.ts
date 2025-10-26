'use server'
import { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import algosdk from "algosdk";
import 'dotenv/config';
import clientPromise from "../../lib/mongoclient";
import { loggers } from "../../lib/logger";
import { Device } from "../../lib/types";
import {
    CommonErrors,
    createApiError,
    ErrorCodes,
    handleApiError,
} from "../../lib/api-errors";

const ENDPOINT = '/api/stake-withdraw';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const session = await getServerSession(req, res, authOptions);
    if (!session || !session.user?.address) {
        res.status(401).json(CommonErrors.noSession());
        return;
    }

    const { address, miner_key } = (req.body ?? {}) as {
        address?: string;
        miner_key?: string;
    };

    if (!address || !miner_key) {
        res.status(400).json(
            createApiError(
                ErrorCodes.INVALID_INPUT,
                'Missing withdrawal parameters',
                'Submit the device miner key and wallet address before requesting a withdrawal.'
            )
        );
        return;
    }

    if (session.user.address !== address) {
        loggers.apiError(ENDPOINT, new Error('Wallet mismatch during stake withdrawal'), {
            sessionAddress: session.user.address,
            address,
            miner_key,
            issueType: 'STAKE_WITHDRAW_WALLET_MISMATCH',
            part: 'stake-withdraw.auth',
        });
        res.status(401).json(CommonErrors.walletMismatch());
        return;
    }

    try {
        const client = await clientPromise;
        const db = client.db('main');
        const collection = db.collection('devices');

        const device = await collection.findOne({ miner_key }) as unknown as Device | null;
        if (!device) {
            res.status(404).json(CommonErrors.deviceNotFound());
            return;
        }

        if (!device.staked) {
            res.status(400).json(
                createApiError(
                    ErrorCodes.NO_STAKE_FOUND,
                    'No stake found to withdraw',
                    'Verify the device staking status before requesting a withdrawal.'
                )
            );
            return;
        }

        const type = device.staked.type;
        const elapsedDays = (Date.now() - new Date(device.staked.time).getTime()) / (1000 * 60 * 60 * 24);
        const available =
            type === 'one' ? elapsedDays > 1 : elapsedDays > 180;

        if (!available) {
            res.status(403).json(
                createApiError(
                    ErrorCodes.OPERATION_IN_PROGRESS,
                    'Stake cannot be withdrawn yet',
                    'Please wait until the stake lock period has passed.'
                )
            );
            return;
        }

        const amount = device.staked.amount;
        const assetId = device.staked.asset_id;

        if (!amount || amount <= 0) {
            res.status(400).json(
                createApiError(
                    ErrorCodes.ZERO_STAKE_AMOUNT,
                    'Stake amount recorded as zero',
                    'Contact support if you believe funds are still locked.'
                )
            );
            return;
        }

        if (!assetId) {
            res.status(500).json(
                createApiError(
                    ErrorCodes.INTERNAL_ERROR,
                    'Missing staking asset for this device',
                    'Please contact support to reconcile the stake record.'
                )
            );
            return;
        }

        const txId = await withdraw(address, amount, assetId);
        if (!txId) {
            res.status(500).json(
                createApiError(
                    ErrorCodes.TRANSACTION_FAILED,
                    'Unable to submit stake withdrawal transaction',
                    'Please try again shortly.'
                )
            );
            return;
        }

        await collection.updateOne(
            { miner_key },
            {
                $set: {
                    staked: {
                        amount: 0,
                        txId,
                        time: new Date(),
                        rewarded_time: new Date(),
                    },
                    verified: false,
                },
            }
        );

        loggers.stakeOperation('withdrawal_submitted', miner_key, {
            address,
            txId,
            amount,
            assetId,
        });

        res.status(200).json({ message: 'ok' });
    } catch (error) {
        handleApiError(res, ENDPOINT, error, {
            response: createApiError(
                ErrorCodes.INTERNAL_ERROR,
                'Error processing stake withdrawal',
                'Please try again. If the issue persists, contact support.'
            ),
            minerKey: miner_key,
            walletAddress: address,
            issueType: 'STAKE_WITHDRAW_ERROR',
            part: 'stake-withdraw.handler',
            metadata: {
                miner_key,
                address,
            },
        });
    }
};

async function withdraw(address: string, amount: number, assetId: string) {
    const mnemonic = process.env.STAKE_MNEMONIC;
    if (!mnemonic) {
        throw new Error("No STAKE_MNEMONIC in env");
    }
    const algodClient = new algosdk.Algodv2(
        "",
        "https://mainnet-api.algonode.cloud",
        ""
    );
    const account = algosdk.mnemonicToSecretKey(mnemonic);
    const params = await algodClient.getTransactionParams().do();

    const transaction = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        sender: account.addr,
        receiver: address,
        amount: amount * 1_000_000,
        note: new Uint8Array(Buffer.from("Stake withdraw" + (Math.floor(Math.random() * 1000)))),
        assetIndex: assetId === 'none' ? 0 : Number(assetId),
        suggestedParams: params
    });
    const signedTxn = transaction.signTxn(account.sk);
    const { txid } = await algodClient.sendRawTransaction(signedTxn).do() as { txid: string };
    const result = await algosdk.waitForConfirmation(algodClient, txid, 3);
    if (result) {
        loggers.txnLog('stake_withdrawal_broadcast', txid, {
            address,
            amount,
            assetId,
        });
    }
    return result ? txid : "";
}
