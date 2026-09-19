'use strict';

// A wallet manager resumes its Pera/WalletConnect session asynchronously, so the connected
// address is null until the manager reports ready. Treat that window as "unknown", not as a
// disconnected wallet — only a ready manager with no wallet, or a genuine address mismatch,
// invalidates the session.
// Addresses arrive as plain strings from the wallet hook and as algosdk Address objects from
// the dev wallet, so both sides are normalised before they are compared.
function normalizeAddress(value) {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value : String(value);
  return text ? text : null;
}

function shouldForceSignOut({ status, sessionAddress, connectedAddress, walletReady }) {
  if (status !== 'authenticated') return false;
  const session = normalizeAddress(sessionAddress);
  if (!session) return false;
  const connected = normalizeAddress(connectedAddress);
  if (connected) return session !== connected;
  return Boolean(walletReady);
}

module.exports = { shouldForceSignOut };
