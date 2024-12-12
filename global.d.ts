declare module globalThis {
  var _mongoClientPromise: Promise<MongoClient>;
}
// types.d.ts

import 'next-auth';

declare module 'next-auth' {
  interface User {
    address: string;
    email: string;
    first_name: string;
    last_name: string;
    poc_wallet: string;
  }

  interface Session {
    user: User & {
      address: string;
      email: string;
      first_name: string;
      last_name: string;
      poc_wallet: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    address: string;
    email: string;
    first_name: string;
    last_name: string;
    poc_wallet: string;
  }
}
