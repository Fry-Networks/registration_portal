declare module globalThis {
  var _mongoClientPromise: Promise<MongoClient>;
}
// types.d.ts

import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      name: string;
      email: string;
      image: string;
      admin: boolean; // Your custom session property
      owner: boolean; // Your custom session property
    };
  }
}
