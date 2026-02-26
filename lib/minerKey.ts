import crypto from 'node:crypto';

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Generates a miner key using a secure random source and the standard prefix + 32-char body format.
 * Prefix should be the product key (e.g., AEM, OLWQM).
 */
export const generateMinerKey = (prefix: string, bodyLength = 32): string => {
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
