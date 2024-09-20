
'use server'
import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import algosdk from "algosdk";
import 'dotenv/config';
import clientPromise from "../../lib/mongoclient";
import { getFRYPrice } from "../../lib/price";
import { Device } from "../../lib/types";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {

    const session = await getServerSession(req, res, authOptions);
    // Check if user is authenticated
    if (!session || !session.user) {
        console.log(`no session`);
        res.status(401).json({ message: "Unauthorized 1" });
        return;
    }

    const data: {
        address: string
        miner_key: string
    } = req.body;

    const { address, miner_key } = data;
    if (session.user.address !== address || !address) {
        console.log(`get miner type session.user.address: ${session.user.address}, address: ${address} SPOOF`);
        res.status(401).json({ message: "Unauthorized 2" });
        return;
    }
    try {
        const client = await clientPromise;
        const db = client.db('main');
        const collection = db.collection('devices');
        console.log(req.body)
        const device = await collection.findOne({ miner_key }) as unknown as Device;
        if (!device) {
            res.status(404).json({ message: "not found" });
            return;
        }
        if(!device.staked) {
            res.status(401).json({ message: "Unauthorized 3" });
            return;
        }
        const type = device.staked.type;
        const check = type == "one"  ? (Date.now() - new Date(device.staked.time).getTime()) / (1000 * 60 /** 60 * 24*/) > 1 : (Date.now() - new Date(device.staked.time).getTime()) / (1000 * 60 * 60 * 24) > 180;
        if (!check) {
            res.status(401).json({ message: "Unauthorized 4" });
            return;
        }
        const amount = device.staked.amount;
        if(!amount) {
            res.status(401).json({ message: "Unauthorized 5" });
            return;
        }
        const result = await withdraw(address, amount);
        if(!result) {
            res.status(500).json({ message: "error" });
            return;
        }
        await collection.updateOne( { miner_key }, { $set: { staked: { amount: 0, txId: result, time: new Date(), rewarded_time: new Date() }, verified: false } });
        console.log(result);
        res.status(200).json({ message: "ok" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "error" });
    }
};



async function withdraw(address: string,amount: number) {
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
    const FRYIndex = 924268058;

    const transaction = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
        from: account.addr,
        to: address,
        amount: amount*1_000_000,
        note: new Uint8Array(Buffer.from("Stake withdraw")),
        assetIndex: FRYIndex,
        suggestedParams: params
    });
    const signedTxn = transaction.signTxn(account.sk);
    const {txId} = await algodClient.sendRawTransaction(signedTxn).do() as { txId: string };
    const result = await algosdk.waitForConfirmation(algodClient, txId, 3);
    return result ? txId : ""
}
