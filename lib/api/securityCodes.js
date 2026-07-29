// @ts-check

/**
 * Classification of the security codes and HTTP statuses the reward APIs return.
 *
 * `DEVICE_FINGERPRINT_REFRESH` (HTTP 409) is the server telling the client it rotated the
 * stored fingerprint and the request should simply be retried — `fetchWithFingerprintRetry`
 * already does that. Only `DEVICE_MISMATCH` (HTTP 403) means the request genuinely came from
 * a different device, which is what warrants signing the user out.
 */

const BLOCKING_SECURITY_CODES = new Set(['DEVICE_MISMATCH']);
const RETRYABLE_SECURITY_CODES = new Set(['DEVICE_FINGERPRINT_REFRESH']);

/**
 * Statuses a batch request can fail with and still succeed on a later revalidation. Fanning a
 * failed batch out into one request per device is only safe when the batch can never recover:
 * with ~85 devices the fan-out immediately trips the 5 req/s limiter, and every 429 then feeds
 * SWR's error retry, which is how one refresh turned into hundreds of requests.
 */
const TERMINAL_BATCH_STATUSES = new Set([400, 401, 403, 404, 405, 410, 422]);

/** @param {string | undefined | null} code */
function isSecurityBlockCode(code) {
  return Boolean(code && BLOCKING_SECURITY_CODES.has(code));
}

/** @param {string | undefined | null} code */
function isRetryableSecurityCode(code) {
  return Boolean(code && RETRYABLE_SECURITY_CODES.has(code));
}

/**
 * True only when a failed batch fetch cannot recover on its own, so a per-device fallback is
 * worth the extra requests. Unknown/missing status is treated as recoverable.
 * @param {{ status?: number, code?: string } | null | undefined} error
 */
function shouldFallBackPerDevice(error) {
  if (!error) return false;
  if (isRetryableSecurityCode(error.code)) return false;
  if (typeof error.status !== 'number') return false;
  return TERMINAL_BATCH_STATUSES.has(error.status);
}

module.exports = {
  BLOCKING_SECURITY_CODES,
  RETRYABLE_SECURITY_CODES,
  TERMINAL_BATCH_STATUSES,
  isSecurityBlockCode,
  isRetryableSecurityCode,
  shouldFallBackPerDevice
};
