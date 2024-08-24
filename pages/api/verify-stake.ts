import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import algosdk from "algosdk";
import clientPromise from "../../lib/mongoclient";
import { getFRYPrice } from "../../lib/price";
import mongoose from "mongoose";
const algodClient = new algosdk.Algodv2(
    "",
    "https://mainnet-api.algonode.cloud",
    ""
);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(req: NextApiRequest, res: NextApiResponse) {

    const session = await getServerSession(req, res, authOptions);
    // Check if user is authenticated
    if (!session || !session.user) {
        res.status(401).json({ message: "Unauthorized 1" });
        return;
    }

    const data: {
        txId: string,
        address: string,
        miner: string,
        type: string
    } = req.body;
    const { miner, txId, address, type } = data;
    try {
        if (session.user.address !== address || !address) {
            console.log(`stake session.user.address: ${session.user.address}, address: ${address} SPOOF`);
            res.status(401).json({ message: "Unauthorized 2" });
            return;
        }
        const client = await clientPromise;
        const db = client.db('main');
        const product = await db.collection('products').findOne({ key: miner.split("-")[0] }) as Product
        if (!product) {
            res.status(404).json({ message: "not found" });
            return;
        }
        /*let price = await getFRYPrice();
        if (!price) return 1;
        const USD = product.reward.stake ?? 0;
        //price = Math.floor((USD / price)) * (process.env.NODE_ENV === 'development' ? 1 : 1000000)
        const FRYamount = Math.floor((USD / price))
        */
        if (!product.reward.stake) {
            res.status(404).json({ message: "product stake empty" });
            return;
        }
        const stake_amt = (type === "one" ? product.reward.stake.stake_one : product.reward.stake.stake_two) ?? 0

        const miner_data = await db.collection('devices').findOne({ miner_key: miner })
        if (!miner_data) {
            res.status(404).json({ message: "miner not found" });
            return;
        }
        if (miner_data.verified) {
            res.status(400).json({ message: "already verified" });
            return;
        }
        const FRYamount = miner_data.byod ? stake_amt / 2 : stake_amt;
        if (FRYamount === 0) {
            res.status(404).json({ message: "withdraw = 0" });
            return
        }
        let price = FRYamount * 1_000_000;
        const result = await confirmTransaction(txId, price);
        console.log(result);
        if (result.code !== 0) {
            console.log(`Transaction verification failed: ${result} for txId: ${txId} and miner: ${miner}`);
            res.status(400).json({ message: "Transaction verification failed" });
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
                        time: new Date()
                    }
                }

            }
        );

        res.status(200).json({ message: "ok" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "error" });
    }
};

const fryReceiver = 'UKVAN7ORIUX7Y6QJFYQ4YGQAZD3RAC7QTDB73S2E5MSILUWAA7FJ6N7WLU';

async function confirmTransaction(txId: string, price: number): Promise<{ code: number, amount?: number }> {
    console.log(txId);
    console.log(price);
    let amount;
    try {

        const lowerBound = price - (price * 0.05); // lower bound is 95% of the price
        const upperBound = price + (price * 0.05); // upper bound is 105% of the price

        // Get the confirmed transaction
        console.log("Getting transaction info for txId: " + txId);
        await wait(2000)
        const confirmedTxn = await algodClient.pendingTransactionInformation(txId).do();
        console.log("Got transaction info");
        // Check if the receiver is correct
        const actualReceiverField = 'arcv';
        const actualReceiver = algosdk.encodeAddress(confirmedTxn['txn']['txn'][actualReceiverField]);
        const receiver = fryReceiver;
        if (actualReceiver !== receiver) return { code: 2 }

        // Check if the amount is correct (assuming price is in MicroAlgos)
        const amountField = 'aamt';
        amount = confirmedTxn['txn']['txn'][amountField] || 0; // Default to 0 if amt field is missing
        if (amount < lowerBound || amount > upperBound) return { code: 3 }
    } catch (error) {
        console.error(error);
        return { code: 4 }
    }
    return { code: 0, amount };
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