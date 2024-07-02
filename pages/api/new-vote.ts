import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import algosdk from "algosdk";
import clientPromise from "../../lib/mongoclient";
const algodClient = new algosdk.Algodv2(
    "",
    "https://mainnet-api.algonode.cloud",
    ""
);
const BURN_ADDRESS = 'MO3FUXGKGZRTVYOSCXR3FXMPZQCZHR2BGGT2B5SINVBA3W6YCZNO25GGLM';
const FRYIndex = 924268058;
export default async function handler(req: NextApiRequest, res: NextApiResponse) {


    const data: {
        index: number,
        txId: string
    } = req.body;

    const { index, txId } = data;
    try {
        let retries = 0;
        console.log("Checking transaction info for txId: ", txId);
        let transactionInfo = await algodClient.pendingTransactionInformation(txId).do();
        while (!transactionInfo['confirmed-round'] && retries < 5) {
            await new Promise((resolve) => setTimeout(resolve, 5000));
            console.log("Retrying transaction info...");
            transactionInfo = await algodClient.pendingTransactionInformation(txId).do();
            console.log(transactionInfo);
            retries++;
        }
        if (!transactionInfo['confirmed-round']) {
            throw new Error("Transaction not confirmed");
        }
        console.log("Transaction confirmed in round: ", transactionInfo['confirmed-round']);
        const note = Buffer.from(transactionInfo.txn.txn.note).toString();
        const voteIndex = note.split("-")[0];
        if (parseInt(voteIndex) !== index) {
            throw new Error("Invalid vote index");
        }
        const assetAmount = transactionInfo.txn.txn.aamt;
        const votes = assetAmount / 1e6;
        const client = await clientPromise;
        const db = client.db();
        const collection = db.collection('dao');
        const currentVote = await collection.findOne({ current: true });
        if (!currentVote) {
            throw new Error("No active vote found");
        }
        const sender = algosdk.encodeAddress(transactionInfo.txn.txn.snd);
        console.log("Sender: ", sender);

        const newUser = currentVote.votes[index].different_people.indexOf(sender) === -1;
        if (newUser) {
            await collection.updateOne(
                { _id: currentVote._id, "votes.option": index.toString() },
                {   
                    $set: { "hadVotes": true },
                    $inc: { "votes.$.votes": votes },
                    $push: { "votes.$.different_people": sender }
                }
            );
        } else {
            await collection.updateOne(
                { _id: currentVote._id, "votes.option": index.toString() },
                {
                    $set: { "hadVotes": true },
                    $inc: { "votes.$.votes": votes }
                }
            );
        }
        



        res.status(200).json({ message: "ok" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "error" });
    }
};