/**
 * Request Signature Generation (CLIENT-SIDE ONLY)
 * 
 * This file contains ONLY the client-side signature generation function.
 * It has NO dependencies on server-only modules (no MongoDB, no Node.js libs).
 * 
 * Server-side verification is in requestSignature.server.ts
 */

const SIGNATURE_SECRET = process.env.NEXT_PUBLIC_REQUEST_SIGNATURE_SECRET;
if (!SIGNATURE_SECRET) {
  throw new Error('NEXT_PUBLIC_REQUEST_SIGNATURE_SECRET environment variable is required');
}

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
  const message = `${method}|${path}|${JSON.stringify(body)}|${timestamp}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const keyData = encoder.encode(SIGNATURE_SECRET);

  if (typeof window !== 'undefined' && crypto?.subtle) {
    // Preferred path: leverage Web Crypto API when available
    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, data);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback for environments without Web Crypto (e.g., some in-app browsers or HTTP contexts)
  try {
    const [{ hmac }, { sha256 }, { bytesToHex }] = await Promise.all([
      import('@noble/hashes/hmac'),
      import('@noble/hashes/sha256'),
      import('@noble/hashes/utils')
    ]);

    const mac = hmac.create(sha256, keyData);
    mac.update(data);
    return bytesToHex(mac.digest());
  } catch (fallbackError) {
    console.error('Request signature fallback failed', fallbackError);
    throw new Error('WebCrypto API not available');
  }
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
