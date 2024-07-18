import { NextApiRequest, NextApiResponse } from "next";
import axios from "axios";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import algosdk from "algosdk";
import clientPromise from "../../../lib/mongoclient";
export default async function handler(req: NextApiRequest, res: NextApiResponse) {

    const session = await getServerSession(req, res, authOptions);
    // Check if user is authenticated
    if (!session || !session.user) {
        console.log(`no session`);
        res.status(401).json({ message: "Unauthorized 1" });
        return;
    }
    const data: {
        miner_key: string,
        names: { [key: string]: string },
        email: string,
        orderNumber: string,
        address: string,
        mac: string,
        [key: string]: any, // Add index signature
    } = req.body;

    const { miner_key, names, email, orderNumber, address, mac } = data;
    if (session.user.address !== address || !address) {
        console.log(`session.user.address: ${session.user.address}, address: ${address} SPOOF`);
        res.status(401).json({ message: "Unauthorized 2" });
        return;
    }

    try {

        const miner_type = miner_key.split('-')[0];
        const client = await clientPromise;
        const db = client.db('main');
        const collection = db.collection('devices');
        const exists = await collection.findOne({ miner_key });
        for (const key in data) {
            if(key === 'names') {
                let error = validateInput('first_name', data[key].first_name);
                if (error) {
                    res.status(400).json({ message: error });
                    return;
                }
                error = validateInput('last_name', data[key].last_name);
                if (error) {
                    res.status(400).json({ message: error });
                    return;
                }
            } else if(key !== 'miner_key' && key !== 'address' ) {
                const error = validateInput(key, data[key]);
                if (error) {
                    res.status(400).json({ message: error });
                    return;
                }
            }
        }
        if (!exists) {
            res.status(400).json({ message: "Not found" });
            return;
        }
        console.log(exists);
        if (exists.is_registered) {
            res.status(400).json({ message: "Already registered" });
            return;
        }
        await collection.updateOne({ miner_key }, {
            $set: {
                is_registered: true, names: names, email: email, orderNumber: orderNumber, address: address, mac: mac
            }
        });
        console.log(`Registered ${miner_key} with mac ${mac}`);

        res.status(200).json({ message: "ok" });
    } catch (error) {
        console.log(error);
        res.status(500).json({ message: "error" });
    }
};


const validateInput = (name: string, value: string) => {
    let regex;
    let error = '';
    if (!value) {
        error = 'This field is required';
    }
    switch (name) {
        case 'first_name':
        case 'last_name':
            regex = /^[a-zA-Z\ -]+$/;
            error = regex.test(value) ? '' : 'Only alphabets are allowed.';
            break;
        case 'email':
            regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            error = regex.test(value) ? '' : 'Invalid email format.';
            break;
        case 'orderNumber':
            regex = /^[0-9]{5}$/;
            error = regex.test(value) ? '' : 'Order number can only contain uppercase letters and numbers. Must be 5 characters long.';
            break;
        case 'mac':
            error = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/g.test(value) ? '' : 'Invalid MAC address';
            break;
        default:
            console.log(name);
            error = "Invalid input"
            break;
    }
    return error;
};