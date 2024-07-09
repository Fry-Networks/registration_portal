import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import algosdk from "algosdk";
import clientPromise from "../../lib/mongoclient";
import { getFRYPrice } from "../../lib/price";
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
    } = req.body;
    const { miner, txId, address } = data;
    try {
        if (session.user.address !== address || !address) {
            console.log(`burn session.user.address: ${session.user.address}, address: ${address} SPOOF`);
            res.status(401).json({ message: "Unauthorized 2" });
            return;
        }

        const result = await confirmTransaction(txId);
        if (result !== 0) {
            console.log(`Transaction verification failed: ${result} for txId: ${txId} and miner: ${miner}`);
            res.status(400).json({ message: "Transaction verification failed" });
            return;
        }

        const client = await clientPromise;
        const db = client.db('main');
        const collection = db.collection('devices');
        await collection.updateOne(
            { miner_key: miner, address: session.user.address },
            {
                $set: {
                    verified: true
                }

            }
        );

        res.status(200).json({ message: "ok" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "error" });
    }
};


const USDAmount = 50;
const fryReceiver = 'MO3FUXGKGZRTVYOSCXR3FXMPZQCZHR2BGGT2B5SINVBA3W6YCZNO25GGLM';

async function confirmTransaction(txId: string): Promise<number> {
    console.log(txId);
    try {
    let price = await getFRYPrice();
    if (!price) return 1;
    price = Math.floor((USDAmount / price)) * (process.env.NODE_ENV === 'development' ? 1 : 1000000)
    console.log(price);

    const lowerBound = price - (price * 0.05); // lower bound is 95% of the price
    const upperBound = price + (price * 0.05); // upper bound is 105% of the price

    // Get the confirmed transaction
    console.log("Getting transaction info for txId: " + txId);
    await wait(2000)
    const confirmedTxn = await algodClient.pendingTransactionInformation(txId).do();
    console.log("Got transaction info: " + JSON.stringify(confirmedTxn));
    // Check if the receiver is correct
    const actualReceiverField = 'arcv';
    const actualReceiver = algosdk.encodeAddress(confirmedTxn['txn']['txn'][actualReceiverField]);
    const receiver = fryReceiver;
    if (actualReceiver !== receiver) return 2;

    // Check if the amount is correct (assuming price is in MicroAlgos)
    const amountField = 'aamt';
    const amount = confirmedTxn['txn']['txn'][amountField] || 0; // Default to 0 if amt field is missing
    if (amount < lowerBound || amount > upperBound) return 3;
    } catch (error) {
        console.error(error);
        return 4;
    }
    return 0;
}