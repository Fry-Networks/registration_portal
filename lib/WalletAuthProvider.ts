import { Provider } from 'next-auth/providers';
import { verifySignature } from './auth';
import clientPromise from './mongoclient';

export default function WalletAuthProvider(): Provider {
  return {
    id: 'wallet',
    name: 'Wallet',
    type: 'credentials',
    credentials: {
      address: { label: 'Address', type: 'text' },
      signedTxn: { label: 'Signature', type: 'text' },
      nonce: { label: 'Nonce', type: 'text' },
      email: { label: 'Email', type: 'text' },
      first_name: { label: 'First Name', type: 'text' },
      last_name: { label: 'Second Name', type: 'text' }
    },
    authorize: async (credentials) => {
      if (
        !credentials?.address ||
        !credentials?.signedTxn ||
        !credentials?.nonce
      ) {
        console.error('Missing credentials');
        return null;
      }

      const isValid = await verifySignature(
        credentials.address,
        credentials.signedTxn,
        credentials.nonce
      );

      if (isValid) {
        const client = await clientPromise;
        const db = client.db('main');
        const collection = db.collection('registration-users');
        const exists = await collection.findOne({
          address: credentials.address
        });
        if (exists) {
          const admin = Boolean(exists.admin);
          const lastDeviceFingerprint = exists.last_device_fingerprint;
          const lastUserAgent = exists.last_user_agent;
          // If existing user lacks profile fields and credentials provide them, update the record
          const needsUpdate =
            !exists.email || !exists.first_name || !exists.last_name;
          if (
            needsUpdate &&
            credentials.email &&
            credentials.first_name &&
            credentials.last_name
          ) {
            await collection.updateOne(
              { address: credentials.address },
              {
                $set: {
                  email: credentials.email,
                  first_name: credentials.first_name,
                  last_name: credentials.last_name
                }
              }
            );
            return {
              id: exists._id?.toString() ?? credentials.address,
              address: credentials.address,
              email: credentials.email,
              first_name: credentials.first_name,
              last_name: credentials.last_name,
              admin,
              last_device_fingerprint: lastDeviceFingerprint,
              last_user_agent: lastUserAgent
            };
          }
          return {
            id: exists._id?.toString() ?? credentials.address,
            address: credentials.address,
            email: exists.email,
            first_name: exists.first_name,
            last_name: exists.last_name,
            admin,
            last_device_fingerprint: lastDeviceFingerprint,
            last_user_agent: lastUserAgent
          };
        } else {
          const insertResult = await collection.insertOne({
            address: credentials.address,
            email: credentials.email,
            first_name: credentials.first_name,
            last_name: credentials.last_name,
            admin: false
          });
          return {
            id: insertResult.insertedId.toString(),
            address: credentials.address,
            email: credentials.email,
            first_name: credentials.first_name,
            last_name: credentials.last_name,
            admin: false,
            last_device_fingerprint: null,
            last_user_agent: null
          };
        }
      }

      return null;
    }
  };
}
