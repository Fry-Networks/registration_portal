import NextAuth, { NextAuthOptions } from 'next-auth';
import 'dotenv/config';
import GithubProvider from 'next-auth/providers/github';
import { MongoDBAdapter } from "@auth/mongodb-adapter"
import clientPromise from "../../../lib/mongoclient"
import { Adapter } from 'next-auth/adapters';
import { Session } from 'next-auth';
console.log((process.env.NODE_ENV === 'development' ? process.env.GITHUB_ID_DEV : process.env.GITHUB_ID) )
export const authOptions: NextAuthOptions = {
  jwt: {
    secret: process.env.NEXTAUTH_SECRET as string,

  },
  adapter: MongoDBAdapter(clientPromise, {
    collections: {
      Accounts: 'webaccounts',
      Sessions: 'websessions',
      Users: 'webusers',
      VerificationTokens: 'webverificationtokens',
    },

    databaseName: 'main',
  }) as Adapter,
  providers: [
    GithubProvider({
      clientId: (process.env.NODE_ENV === 'development' ? process.env.GITHUB_ID_DEV : process.env.GITHUB_ID) as string,
      clientSecret: (process.env.NODE_ENV === 'development' ? process.env.GITHUB_SECRET_DEV : process.env.GITHUB_SECRET) as string,

    }),
  ],
  session: {
    strategy: 'database',
  },
  callbacks: {
    async session({ session, token, user }) {
      //@ts-ignore
      session.user = user;
      return session;
    }
  }
};

export default NextAuth(authOptions);


export interface MySession extends Session {
  user: {
    id: string;
    name: string;
    email: string;
    image: string;
    emailVerified: string | null;
    admin: boolean;
    owner: boolean;
  }
}
