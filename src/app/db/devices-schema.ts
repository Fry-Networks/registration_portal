import mongoose, { mongo } from 'mongoose';
export const devicesSchema = new mongoose.Schema({
	user_id: mongoose.Schema.Types.ObjectId,
    miner_key: String, 
    name: String,
    order_no: Number,
    address: { type: String, default: '' },
    is_registered: { type: Boolean, default: false },
    registered_at: Date
 
});
export interface Device extends mongoose.Document {
	user_id: mongoose.Schema.Types.ObjectId | string,
    miner_key: string,
    name: string,
    order_no: number,
    address: string,
    is_registered: boolean,
    registered_at: Date,
}

const DeviceModel = (mongoose.models.device || mongoose.model<Device>('device', devicesSchema)) as mongoose.Model<Device>;

export default DeviceModel;
