/**
 * Request Signature Generation (CLIENT-SIDE ONLY)
 * 
 * This file contains ONLY the client-side signature generation function.
 * It has NO dependencies on server-only modules (no MongoDB, no Node.js libs).
 * 
 * Server-side verification is in requestSignature.server.ts
 */

const SIGNATURE_SECRET = process.env.NEXT_PUBLIC_REQUEST_SIGNATURE_SECRET || 'REDACTED_ROTATE_ME';

/**
 * Generate an HMAC-SHA256 signature for a request.
 * 
 * Frontend usage:
 *   const signature = await generateRequestSignatureAsync('POST', '/api/rewards/claim', body, timestamp);
 */
export async function generateRequestSignatureAsync(
  method: string,
  path: string,
  body: any,
  timestamp: number
): Promise<string> {
  if (typeof window === 'undefined' || !crypto) {
    throw new Error('WebCrypto API not available');
  }

  const message = `${method}|${path}|${JSON.stringify(body)}|${timestamp}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const keyData = encoder.encode(SIGNATURE_SECRET);

  // Generate HMAC-SHA256 using Web Crypto API
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, data);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Synchronous version (returns pending placeholder - use async version instead)
 * Kept for backward compatibility
 */
export function generateRequestSignature(
  method: string,
  path: string,
  body: any,
  timestamp: number
): string {
  // Only available in browser with WebCrypto
  if (typeof window === 'undefined') {
    throw new Error('generateRequestSignature can only be called from browser');
  }

  // Return a placeholder that will be computed async
  return `pending:${timestamp}`;
}
