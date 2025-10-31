/**
 * Device Fingerprinting Utility
 * 
 * Generates and validates device fingerprints to prevent cookie-based
 * replay attacks from automated scripts.
 * 
 * Even if a script obtains valid session cookies, the device fingerprint
 * won't match, preventing automated execution.
 */

import { NextApiRequest } from 'next';
import crypto from 'crypto';
import { logSecurityEventAggregated } from './securityEventAggregation';

type FingerprintState = {
  lastMismatch: number;
  retryCount: number;
};

type FingerprintLogState = {
  lastLogged: number;
};

const globalAny = globalThis as typeof globalThis & {
  __fingerprintState?: Map<string, FingerprintState>;
  __fingerprintLogState?: Map<string, FingerprintLogState>;
};

const fingerprintState =
  globalAny.__fingerprintState ?? new Map<string, FingerprintState>();
if (!globalAny.__fingerprintState) {
  globalAny.__fingerprintState = fingerprintState;
}

const fingerprintLogState =
  globalAny.__fingerprintLogState ?? new Map<string, FingerprintLogState>();
if (!globalAny.__fingerprintLogState) {
  globalAny.__fingerprintLogState = fingerprintLogState;
}

const GRACE_WINDOW_MS = 30_000;
const MAX_MISMATCH_RETRIES = 3;
const LOG_WINDOW_MS = 5_000;

export type FingerprintVerificationResult = 'ok' | 'retry' | 'blocked';

export function clearFingerprintState(walletAddress: string) {
  if (!walletAddress) return;
  fingerprintState.delete(walletAddress);
  fingerprintLogState.delete(walletAddress);
}

/**
 * Helper: Format and log security event to console
 */
function formatSecurityLog(
  layerName: string,
  eventType: string,
  walletAddress: string,
  minerKey: string,
  details?: string
): string {
  const timestamp = new Date().toISOString();
  const detail = details ? ` - ${details}` : '';
  return `[${layerName}] ${timestamp}${detail} | Wallet: ${walletAddress} | Miner: ${minerKey}`;
}

/**
 * Helper: Log a device fingerprinting event to console and aggregated MongoDB summary
 */
async function logFingerprintEvent(
  req: NextApiRequest,
  type: 'DEVICE_FINGERPRINT_BYPASS' | 'DEVICE_FINGERPRINT_MISSING' | 'DEVICE_FINGERPRINT_MISMATCH',
  walletAddress: string,
  minerKey: string,
  errorMessage?: string
): Promise<void> {
  // Determine layer name and event details based on type
  let layerName = 'L4 - DeviceFingerprint';
  let eventDetails = '';
  let severity: 'low' | 'medium' | 'high' | 'critical' = 'high';
  
  if (type === 'DEVICE_FINGERPRINT_BYPASS') {
    eventDetails = errorMessage ?? 'Admin bypass allowed';
    severity = 'low';
  } else if (type === 'DEVICE_FINGERPRINT_MISSING') {
    eventDetails = 'No fingerprint in session';
    severity = 'high';
  } else if (type === 'DEVICE_FINGERPRINT_MISMATCH') {
    eventDetails = 'Device fingerprint mismatch - script detected';
    severity = 'high';
  }

  // Format and log to console
  const consoleLog = formatSecurityLog(layerName, type, walletAddress, minerKey, eventDetails);
  
  if (type === 'DEVICE_FINGERPRINT_BYPASS') {
    console.log(consoleLog); // Info level for allowed bypasses
  } else {
    console.warn(consoleLog); // Warn level for security events
  }

  // Log to aggregated MongoDB (updates wallet's summary document)
  await logSecurityEventAggregated(
    req,
    type,
    walletAddress,
    minerKey,
    severity,
    errorMessage
  );
}

/**
 * Generate a device fingerprint from request headers.
 * 
 * Combines multiple identifying factors to create a unique fingerprint
 * for the device/browser that made the request.
 * 
 * Factors included:
 * - User-Agent string
 * - Accept-Language header
 * - Accept-Encoding header
 * - Accept-Header
 * 
 * A script will have DIFFERENT values than a browser!
 */
export function generateDeviceFingerprint(req: NextApiRequest): string {
  const factors = [
    req.headers['user-agent'] || '',
    req.headers['accept-language'] || '',
    req.headers['accept-encoding'] || '',
    req.headers['accept'] || '',
    req.headers['sec-ch-ua'] || '', // Chrome/Edge specific
    req.headers['sec-ch-ua-mobile'] || '', // Mobile indicator
  ].join('|');

  return crypto.createHash('sha256').update(factors).digest('hex');
}

/**
 * Extract fingerprint from session (stored during login).
 * 
 * When user logs in with browser, store the device fingerprint.
 * On subsequent requests, verify fingerprint matches.
 * 
 * @param session - NextAuth session object
 * @returns stored fingerprint or null
 */
export function getStoredFingerprint(session: any): string | null {
  return session?.deviceFingerprint || null;
}

/**
 * Verify request device fingerprint matches stored fingerprint.
 * 
 * If fingerprints don't match, the request is from a different device/script.
 * 
 * @param req - NextApiRequest
 * @param storedFingerprint - fingerprint stored during login
 * @returns true if fingerprints match, false otherwise
 */
export function verifyDeviceFingerprint(
  req: NextApiRequest,
  storedFingerprint: string | null
): boolean {
  if (!storedFingerprint) {
    // No fingerprint stored (shouldn't happen with new sessions)
    return false;
  }

  const currentFingerprint = generateDeviceFingerprint(req);
  
  // Simple string comparison (both are hex digests)
  const match = storedFingerprint === currentFingerprint;
  
  return match;
}

/**
 * Middleware: Verify device fingerprint on sensitive operations.
 * 
 * Admin wallets bypass this check (they can use scripts).
 * Non-admin wallets must match the device fingerprint.
 * 
 * Usage:
 *   const fingerprint = verifyDeviceFingerprintMiddleware(req, session, isAdmin, context);
 *   if (!fingerprint) {
 *     return res.status(403).json({ error: 'Device mismatch' });
 *   }
 * 
 * @param req - NextApiRequest
 * @param session - NextAuth session
 * @param isAdmin - whether user is admin
 * @param context - optional context { walletAddress, minerKey } for logging
 */
function shouldLogMismatch(walletAddress: string): boolean {
  if (!walletAddress) return true;
  const now = Date.now();
  const entry = fingerprintLogState.get(walletAddress);
  if (!entry || now - entry.lastLogged > LOG_WINDOW_MS) {
    fingerprintLogState.set(walletAddress, { lastLogged: now });
    return true;
  }
  return false;
}

export async function verifyDeviceFingerprintMiddleware(
  req: NextApiRequest,
  session: any,
  isAdmin: boolean = false,
  context?: { walletAddress?: string; minerKey?: string }
): Promise<FingerprintVerificationResult> {
  const walletAddress = context?.walletAddress || session?.user?.address || 'unknown';
  const minerKey = context?.minerKey || 'unknown';

  const fingerprintBypass = (process.env.DISABLE_DEVICE_FINGERPRINT || '')
    .toString()
    .toLowerCase();
  const fingerprintBypassEnabled =
    fingerprintBypass === 'true' || fingerprintBypass === '1' || fingerprintBypass === 'yes';

  if (fingerprintBypassEnabled) {
    await logFingerprintEvent(
      req,
      'DEVICE_FINGERPRINT_BYPASS',
      walletAddress,
      minerKey,
      'Global fingerprint bypass enabled via DISABLE_DEVICE_FINGERPRINT'
    );
    return 'ok';
  }

  // Allow internal SSR/service requests to bypass fingerprint checks
  if ((req.headers['x-internal-request'] || '').toString().toLowerCase() === 'next-ssr') {
    await logFingerprintEvent(
      req,
      'DEVICE_FINGERPRINT_BYPASS',
      walletAddress,
      minerKey,
      'Internal Next.js request bypassed device fingerprint check'
    );
    return 'ok';
  }

  // Admins bypass fingerprint check (can use scripts)
  if (isAdmin) {
    await logFingerprintEvent(
      req,
      'DEVICE_FINGERPRINT_BYPASS',
      walletAddress,
      minerKey,
      'Admin wallet bypassed device fingerprint check'
    );
    return 'ok';
  }

  if (!session?.deviceFingerprint) {
    if (shouldLogMismatch(walletAddress)) {
      await logFingerprintEvent(
        req,
        'DEVICE_FINGERPRINT_MISSING',
        walletAddress,
        minerKey,
        'No device fingerprint stored in session'
      );
    }
    fingerprintState.set(walletAddress, {
      lastMismatch: Date.now(),
      retryCount: 0
    });
    return 'retry';
  }

  const isValid = verifyDeviceFingerprint(req, session.deviceFingerprint);
  
  if (!isValid) {
    const now = Date.now();
    const state = fingerprintState.get(walletAddress);
    const withinWindow = state ? now - state.lastMismatch <= GRACE_WINDOW_MS : false;
    const retryCount = withinWindow && state ? state.retryCount : 0;

    if (shouldLogMismatch(walletAddress)) {
      const storedFingerprint = session.deviceFingerprint.substring(0, 16) + '...';
      const currentFingerprint = generateDeviceFingerprint(req).substring(0, 16) + '...';
      const storedUserAgent = session.userAgent || 'unknown';
      const currentUserAgent = req.headers['user-agent'] || 'unknown';

      console.warn('[DeviceFingerprint] Fingerprint mismatch detected');
      console.warn('  Stored fingerprint:', storedFingerprint);
      console.warn('  Current fingerprint:', currentFingerprint);
      console.warn('  Stored User-Agent:', storedUserAgent);
      console.warn('  Current User-Agent:', currentUserAgent);

      await logFingerprintEvent(
        req,
        'DEVICE_FINGERPRINT_MISMATCH',
        walletAddress,
        minerKey,
        `Device fingerprint mismatch - possible script or unauthorized access`
      );
    }

    if (retryCount < MAX_MISMATCH_RETRIES) {
      fingerprintState.set(walletAddress, {
        lastMismatch: now,
        retryCount: retryCount + 1
      });
      return 'retry';
    }

    fingerprintState.set(walletAddress, {
      lastMismatch: now,
      retryCount
    });
    return 'blocked';
  }

  fingerprintState.delete(walletAddress);
  return 'ok';
}
