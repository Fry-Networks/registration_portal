import NextAuth, { NextAuthOptions } from 'next-auth';
import 'dotenv/config';
import GithubProvider from 'next-auth/providers/github';
import WalletAuthProvider from '../../../lib/WalletAuthProvider';
//@ts-ignore
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import clientPromise from '../../../lib/mongoclient';
import { Adapter } from 'next-auth/adapters';
import { Session } from 'next-auth';
//console.log((process.env.NODE_ENV === 'development' ? process.env.GITHUB_ID_DEV : process.env.GITHUB_ID) )
export const authOptions: NextAuthOptions = {
  jwt: {
    secret: process.env.NEXTAUTH_SECRET as string
  },
  providers: [WalletAuthProvider()],
  session: {
    strategy: 'jwt'
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.address = user.address;
        token.email = user.email;
        token.first_name = user.first_name;
        token.last_name = user.last_name;
        token.admin = Boolean((user as any)?.admin);
      } else if (typeof token.admin === 'undefined') {
        token.admin = false;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          ...session.user,
          address: token.address as string,
          email: token.email as string,
          first_name: token.first_name as string,
          last_name: token.last_name as string,
          admin: Boolean(token.admin)
        };
      }
      return session;
    }
  },
  pages: {
    signIn: '/signin'
  }
};
export default NextAuth(authOptions);

export interface MySession extends Session {
  user: {
    id: string;
    name: string;
    email: string;
    first_name: string;
    last_name: string;
    image: string;
    address: string;
    emailVerified: string | null;
    admin: boolean;
    owner: boolean;
  };
}
