import NextAuth, { NextAuthOptions } from 'next-auth';
import 'dotenv/config';
import GithubProvider from 'next-auth/providers/github';
import WalletAuthProvider from '../../../lib/WalletAuthProvider';
//@ts-ignore
import { MongoDBAdapter } from '@auth/mongodb-adapter';
import clientPromise from '../../../lib/mongoclient';
import { Adapter } from 'next-auth/adapters';
import { Session } from 'next-auth';
export const authOptions: NextAuthOptions = {
  jwt: {
    secret: process.env.NEXTAUTH_SECRET as string
  },
  providers: [WalletAuthProvider()],
  session: {
    strategy: 'jwt'
  },
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.userId = (user as any).id ?? token.sub ?? token.userId;
        token.address = user.address;
        token.email = user.email;
        token.first_name = user.first_name;
        token.last_name = user.last_name;
        token.admin = Boolean((user as any)?.admin);
        token.deviceFingerprint =
          (user as any)?.last_device_fingerprint ?? token.deviceFingerprint ?? null;
        token.userAgent =
          (user as any)?.last_user_agent ?? token.userAgent ?? null;
      } else if (trigger === 'update' && session) {
        if (typeof session.deviceFingerprint !== 'undefined') {
          token.deviceFingerprint = session.deviceFingerprint;
        }
        if (typeof session.userAgent !== 'undefined') {
          token.userAgent = session.userAgent;
        }
      } else {
        if (!token.userId && token.sub) {
          token.userId = token.sub;
        }
        if (typeof token.admin === 'undefined') {
          token.admin = false;
        }
      }

      if (typeof token.deviceFingerprint === 'undefined') {
        token.deviceFingerprint = null;
      }
      if (typeof token.userAgent === 'undefined') {
        token.userAgent = null;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user = {
          ...session.user,
          id: (token.userId ?? token.sub ?? '') as string,
          address: token.address as string,
          email: token.email as string,
          first_name: token.first_name as string,
          last_name: token.last_name as string,
          admin: Boolean(token.admin)
        } as typeof session.user & { id: string };
        (session as any).deviceFingerprint =
          typeof token.deviceFingerprint === 'string'
            ? token.deviceFingerprint
            : token.deviceFingerprint ?? null;
        (session as any).userAgent =
          typeof token.userAgent === 'string'
            ? token.userAgent
            : token.userAgent ?? null;
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
  deviceFingerprint?: string | null;
  userAgent?: string | null;
}
