'use server';
import 'dotenv/config';
import mongoose from 'mongoose';
import logger from './logger';
import { logDatabaseConnection } from './startup-logger';
export async function connect() {
    if(mongoose.connection.readyState >= 1) return;

    const uri = process.env.MONGO_URI;
    if (!uri) {
        throw new Error('MONGO_URI not set!');
    }
    logger.info('Connecting to MongoDB...', { database: 'MongoDB' });
    await mongoose.connect(uri, { dbName: 'main' });
    logDatabaseConnection('connected');

    mongoose.connection.on('connected', () => {
        logDatabaseConnection('connected');
    });

    mongoose.connection.on('error', (err) => {
        logDatabaseConnection('error', err);
    });

    mongoose.connection.on('disconnected', () => {
        logger.warn('Disconnected from MongoDB', { database: 'MongoDB' });
    });
}
