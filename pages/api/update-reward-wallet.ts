import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import algosdk from "algosdk";
import clientPromise from "../../lib/mongoclient";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {

    const session = await getServerSession(req,res, authOptions);
    // Check if user is authenticated
    if (!session || !session.user) {
        console.log(`no session`);
        res.status(401).json({ message: "Unauthorized 1" });
        return;
    }
    
    const data: {
        miner: number,
        reward_wallet: string,
        address: string
    } = req.body;

    const { miner, reward_wallet, address } = data;
    try {
        if(session.user.address !== address || !address){
            console.log(`reward session.user.address: ${session.user.address}, address: ${address} SPOOF`);
            res.status(401).json({ message: "Unauthorized 2" });
            return;
        }
        const client = await clientPromise;
        const db = client.db('main');
        const collection = db.collection('devices');
        const test = await collection.findOne({ miner_key: miner, address: session.user.address });
            await collection.updateOne(
                { miner_key: miner, address: session.user.address },
                {   
                    $set: { "reward_wallet": reward_wallet }
                }
            );
       
        res.status(200).json({ message: "ok" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "error" });
    }
};

