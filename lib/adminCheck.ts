/**
 * Admin Check Utility
 * 
 * Provides centralized logic for checking if a wallet address has admin privileges.
 * Admin users bypass all security layers (token, signature, session verification).
 * 
 * Used by:
 * - clientTokenMiddleware.ts (token verification)
 * - requestSignature.server.ts (signature verification)
 * - All reward endpoints (layer checks)
 */

import { NextApiRequest } from 'next';
import clientPromise from './mongoclient';

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
 * Extract wallet address from request (multiple sources).
 * 
 * Checks in this order:
 * 1. req.body.address (POST body)
 * 2. req.body.wallet (alternative POST body field)
 * 3. x-wallet header
 * 4. x-address header
 * 
 * @param req - NextApiRequest object
 * @returns wallet address or undefined
 */
export function extractWalletFromRequest(req: NextApiRequest): string | undefined {
  try {
    // Check request body first
    if (req.body?.address) return req.body.address;
    if (req.body?.wallet) return req.body.wallet;
    
    // Check headers
    if (req.headers['x-wallet']) return req.headers['x-wallet'] as string;
    if (req.headers['x-address']) return req.headers['x-address'] as string;
  } catch (e) {
    // Silently fail
  }
  return undefined;
}

/**
 * Check if a request is from an admin wallet.
 * 
 * Extracts wallet from request and checks admin status.
 * 
 * @param req - NextApiRequest object
 * @returns true if wallet is admin, false otherwise
 */
export async function isAdminRequest(req: NextApiRequest): Promise<boolean> {
  const wallet = extractWalletFromRequest(req);
  return isAdminWallet(wallet);
}
