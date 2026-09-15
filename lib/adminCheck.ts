/**
 * Admin Check Utility
 *
 * Decides whether the AUTHENTICATED caller is an admin. The wallet address is
 * taken ONLY from the NextAuth session (or the `_sessionWalletAddress` a route
 * stashed from that same session) and is then re-checked against
 * registration-users.admin. Nothing from the request body or headers is trusted:
 * a client-supplied address would let anyone who knows an admin wallet skip the
 * L1 client-token, L2 request-signature and L4 device-fingerprint layers.
 *
 * Used by:
 * - pages/api/rewards/* (boost, claim, confirm, get-asset-totals,
 *   get-reward-summary, get-reward-summary-batch, get-rewards-page)
 * - lib/api/enforceWalletSecurity.ts
 */

import { NextApiRequest } from 'next';
import clientPromise from './mongoclient';

type SessionLike = { user?: { address?: string | null } | null } | null | undefined;
type RequestWithSessionWallet = NextApiRequest & { _sessionWalletAddress?: string };

/**
 * Check if a wallet address has admin privileges.
 *
 * Queries the registration-users collection for the wallet and checks admin field.
 * Returns true if admin field is explicitly set to true.
 *
 * @param walletAddress - The Algorand wallet address
 * @returns true if admin=true, false otherwise
 */
export async function isAdminWallet(walletAddress: string | undefined): Promise<boolean> {
  if (!walletAddress) {
    return false;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const user = await db.collection('registration-users').findOne({
      address: walletAddress
    });

    return user?.admin === true;
  } catch (error) {
    console.error('[AdminCheck] Error checking admin status:', error);
    return false;
  }
}

/**
 * Admin decision for a request.
 *
 * The address comes from the authenticated session only:
 *   session.user.address  ->  req._sessionWalletAddress (stashed by the route from the session)
 * and is then re-checked in the database (the JWT `admin` claim is only refreshed at login).
 * Fail-closed: no session address -> false, database error -> false.
 *
 * @param req - NextApiRequest object (only its `_sessionWalletAddress` stash is read)
 * @param session - the NextAuth session returned by getServerSession, if the caller has it
 * @returns true if the authenticated wallet is admin, false otherwise
 */
export async function isAdminRequest(req: NextApiRequest, session?: SessionLike): Promise<boolean> {
  const address =
    session?.user?.address ?? (req as RequestWithSessionWallet)._sessionWalletAddress;
  if (typeof address !== 'string' || address.length === 0) {
    return false;
  }
  return isAdminWallet(address);
}
