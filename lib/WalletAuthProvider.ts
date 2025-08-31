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
          return {
            id: credentials.address,
            address: credentials.address,
            email: exists.email,
            first_name: exists.first_name,
            last_name: exists.last_name
          };
        } else {
          await collection.insertOne({
            address: credentials.address,
            email: credentials.email,
            first_name: credentials.first_name,
            last_name: credentials.last_name
          });
          return {
            id: credentials.address,
            address: credentials.address,
            email: credentials.email,
            first_name: credentials.first_name,
            last_name: credentials.last_name
          };
        }
      }

      return null;
    }
  };
}
