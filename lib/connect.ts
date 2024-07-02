'use server';
import 'dotenv/config';
import mongoose from 'mongoose';
export async function connect() {
    if(mongoose.connection.readyState >= 1) return;

    const uri = process.env.MONGO_URI;
    if (!uri) {
        throw new Error('MONGO_URI not set!');
    }
    console.log('Connecting to MongoDB...');
    await mongoose.connect(uri);
    console.log('Connected to MongoDB!');
    mongoose.connection.useDb('main');

    mongoose.connection.on('connected', () => {
        console.log('Connected to MongoDB!');
    });

    mongoose.connection.on('error', (err) => {
        console.error(`Mongoose connection error:\n${err.stack}`);
    });

    mongoose.connection.on('disconnected', () => {
        console.log('Disconnected from MongoDB!');
    });
}