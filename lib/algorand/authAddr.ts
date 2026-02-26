import { getAlgodClient } from '../wallet/clients';
import { withAlgorandRetry } from './withRetry';

/**
 * Cache for auth-addr lookups.
 * Key: account address, Value: { authAddr: string | null, timestamp: number }
 */
const authAddrCache = new Map<string, { authAddr: string | null; timestamp: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get the auth-addr for an Algorand account.
 * Returns the auth-addr if the account is rekeyed, or null if not rekeyed.
 *
 * @param address - The account address to check
 * @param forceRefresh - If true, bypass cache and fetch fresh data
 * @returns The auth-addr if rekeyed, null if not rekeyed
 */
export async function getAuthAddr(
  address: string,
  forceRefresh = false
): Promise<string | null> {
  // Check cache first (unless force refresh)
  if (!forceRefresh) {
    const cached = authAddrCache.get(address);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.authAddr;
    }
  }

  const algod = getAlgodClient();
  const accountInfo = await withAlgorandRetry(algod.accountInformation(address));

  // auth-addr field is present only if account is rekeyed
  // If auth-addr equals the account address, it's effectively un-rekeyed
  // algosdk returns kebab-case keys in the response
  const authAddr = (accountInfo as { authAddr?: { toString(): string } }).authAddr?.toString();
  const effectiveAuthAddr = (authAddr && authAddr !== address) ? authAddr : null;

  // Cache the result
  authAddrCache.set(address, {
    authAddr: effectiveAuthAddr,
    timestamp: Date.now(),
  });

  return effectiveAuthAddr;
}

/**
 * Get the address whose public key should be used to verify signatures.
 * For rekeyed accounts, this is the auth-addr.
 * For non-rekeyed accounts, this is the account's own address.
 *
 * @param address - The account address
 * @param forceRefresh - If true, bypass cache
 * @returns The address whose public key should verify signatures
 */
export async function getSigningAddress(
  address: string,
  forceRefresh = false
): Promise<string> {
  const authAddr = await getAuthAddr(address, forceRefresh);
  return authAddr ?? address;
}

/**
 * Clear the auth-addr cache for a specific address or all addresses.
 * Useful when you know a rekey has occurred.
 */
export function clearAuthAddrCache(address?: string): void {
  if (address) {
    authAddrCache.delete(address);
  } else {
    authAddrCache.clear();
  }
}
