import crypto from 'node:crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generates a miner key using a secure random source and the standard prefix + 32-char body format.
 * Prefix defaults to FEM for all new issuances.
 */
export const generateMinerKey = (prefix = 'FEM', bodyLength = 32): string => {
  if (!prefix || prefix.trim().length === 0) {
    throw new Error('Missing miner key prefix');
  }

  const bytes = crypto.randomBytes(bodyLength);
  let body = '';
  for (let i = 0; i < bodyLength; i += 1) {
    body += CHARSET[bytes[i] % CHARSET.length];
  }

  return `${prefix}-${body}`;
};

/**
 * Old IOT- boards were reissued as FEM- devices; the physical label on the board still reads
 * IOT-<hex>. This resolves that legacy key to its live FEM- twin for LOOKUP purposes only -- it
 * grants no ownership, flips no reward/eligibility/claim flag, and an IOT--announcing board must
 * still fail to authenticate (enforced elsewhere; this function is never on that path). Only a
 * strictly uppercase-hex 32-char body qualifies; a base36 body (letters past F) or any other
 * prefix passes through unchanged. Additive and reversible: delete this export and its one call
 * site to fully revert.
 */
export const remapLegacyMinerKey = (input: string): string => {
  const match = /^IOT-([0-9A-F]{32})$/.exec(input);
  return match ? `FEM-${match[1]}` : input;
};

