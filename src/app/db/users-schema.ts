import mongoose, { mongo } from 'mongoose';
export const usersSchema = new mongoose.Schema({
    email: { type: String, default: "" },
    address: { type: String, required: true },
    name: {
        type: {
            first: { type: String, default: "" },
            last: { type: String, default: "" },
            full: { type: String, default: "" }
        }, default: { first: "", last: "", full: "" }
    },

    byod: {
        licenses: { type: [String], default: [] },
        payments: { type: [Date], default: [] }
    }
});
export interface User extends mongoose.Document {
    email: string,
    address: string,
    name: {
        first: string,
        last: string,
        full: string
    },
    byod: {
        licenses: string[],
        payments: Date[]
    }
}

const UserModel = (mongoose.models.user || mongoose.model<User>('user', usersSchema)) as mongoose.Model<User>;


export default UserModel;

export async function getUserByAddress(address: string): Promise<User> {
    let user = await UserModel.findOne({ address: address });
    if (!user) user = await UserModel.create({ address: address });
    return user;
}

export async function getUser(email?: string, address?: string, noCreate?: boolean): Promise<User | null> {
    let user: User | null = email ? await UserModel.findOne({ email: email }) : await UserModel.findOne({ address: address });
    if (!user && !noCreate) user = await UserModel.create({ email: email, address: address });
    return user;
}
