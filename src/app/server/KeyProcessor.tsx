'use server';
import { connect } from "../db/connect";
import mongoose from "mongoose";
import DeviceModel from "../db/devices-schema";
import UserModel from "../db/users-schema";
const rateLimiter = new Map<string, {
    lastRequest: Date,
    requests: number
}>();

export async function processData(data: FormData, address: string): Promise<string> {
    if(rateLimiter.has(address)) {
        const {lastRequest, requests} = rateLimiter.get(address)!;
        if(new Date().getTime() - lastRequest.getTime() < 30_000) {
            if(requests > 5) {
                return "You are sending too many requests, please wait a few seconds and try again.";
            }
            rateLimiter.set(address, {
                lastRequest: new Date(),
                requests: requests + 1
            });
        } else {
            rateLimiter.set(address, {
                lastRequest: new Date(),
                requests: 0
            });
        }
    } else {
        rateLimiter.set(address, {
            lastRequest: new Date(),
            requests: 0
        });
    }

        
    const { firstName, lastName, email, miner_key } = data;

    const nameTests = /^[a-z ,.'-]+$/i.test(firstName) &&
        /^[a-z ,.'-]+$/i.test(lastName) &&
        firstName.length > 0 &&
        lastName.length > 0 &&
        firstName.length < 50 &&
        lastName.length < 50;

    const emailTest = /^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email);
    const minerKeyTest = /^(VPN|OGPS|IGPS|IDB|ODB)-([a-zA-Z]|[0-9]){32}$/.test(miner_key);

    if (!nameTests) {
        return "Please enter valid names";

    }

    if (!emailTest) {
        return "Please enter a valid email";

    }
    if (!minerKeyTest) {
        return "Please enter a valid miner key";
    }

    if (!address) {
        return "Please connect your wallet";
    }

    if (!mongoose.connection.readyState) {
        await connect();
    }

    const isKeyExisting = await DeviceModel.exists({ miner_key });

    if (!isKeyExisting) return "Key not found";

    const key = (await DeviceModel.findOne({ miner_key }))!;

    if (key.is_registered) return "Key already registered";

    const correspondingUser = await UserModel.findOne({ _id: key.user_id });

    if (!correspondingUser) return "User not found";

    if (correspondingUser.email !== email) return "Email doesn't match";

    const name = {
        first: firstName,
        last: lastName,
        full: `${firstName} ${lastName}`
    }
    /*
    UserModel.updateOne({ _id: key.user_id }, { $set: { name, address } }).then((res) => {
        console.log(res);
    });
*/
    DeviceModel.updateOne({ miner_key }, { $set: { is_registered: true, registered_at: new Date(), address  } }).then((res) => {
        console.log(res);
    });

    return "Successfully registered your miner key, you can reload the page if you want to register another key."

}

interface FormData {
    firstName: string;
    lastName: string;
    email: string;
    miner_key: string;
}