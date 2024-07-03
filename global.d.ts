declare module globalThis {
  var _mongoClientPromise: Promise<MongoClient>;
}
// types.d.ts

import 'next-auth'

declare module 'next-auth' {
  interface User {
    address: string;
  }

  interface Session {
    user: User & {
      address: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    address: string;
  }
}