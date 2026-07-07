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

