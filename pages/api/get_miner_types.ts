import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getServerSession } from "next-auth";
import { authOptions } from "./auth/[...nextauth]";
import algosdk from "algosdk";
import clientPromise from "../../lib/mongoclient";
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
    } = req.body;

    const { address } = data;
    console.log(req.body)
    if (session.user.address !== address || !address) {
        console.log(`get miner type session.user.address: ${session.user.address}, address: ${address} SPOOF`);
        res.status(401).json({ message: "Unauthorized 2" });
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
        console.log(error);
        res.status(500).json({ message: "error" });
    }
};

