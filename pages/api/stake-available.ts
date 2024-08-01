
import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import algosdk from "algosdk";
import clientPromise from "../../lib/mongoclient";
import { getFRYPrice } from "../../lib/price";
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
        const device = await collection.findOne({ miner_key })
        if (!device) {
            res.status(404).json({ message: "not found" });
            return;
        }
        if(device.staked.amount == 0) {
            res.status(401).json({ message: "Unauthorized 3" });
            return;
        }
        const dayCheck = (Date.now() - new Date(device.staked.time).getTime())  / (1000 * 60 * 60 * 24) > 1;

        const data = {
            available: dayCheck,
            availableIn: 1 - (Date.now() - new Date(device.staked.time).getTime())  / (1000 * 60 * 60 * 24)
        }

        res.status(200).json({ message: "ok", data });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "error" });
    }
};

