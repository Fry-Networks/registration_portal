/**
 * Server-time offset tracking.
 * 
 * The backend sends serverTime (epoch ms) in reward API responses.
 * We compute an offset between server time and local Date.now()
 * so that signatures and countdowns use server time instead of
 * client time — fixing issues where a skewed client clock causes
 * EXPIRED_TIMESTAMP rejections or incorrect countdown displays.
 */

let serverTimeOffsetMs = 0;

/**
 * Record a serverTime value received from an API response.
 * Computes offset = serverTime - localTime at receipt.
 */
export function setServerTime(serverTime: number): void {
  serverTimeOffsetMs = serverTime - Date.now();
}

/**
 * Current best estimate of server time (epoch ms).
 * = local Date.now() + tracked offset from last serverTime response.
 */
export function getServerTime(): number {
  return Date.now() + serverTimeOffsetMs;
}

/**
 * Timestamp in whole seconds, suitable for x-request-timestamp header.
 */
export function getServerTimestamp(): number {
  return Math.floor(getServerTime() / 1000);
}

/**
 * The tracked offset itself (serverTime - localTime), in ms.
 *
 * RC5 (r12): the claim UI needs the magnitude of the skew to tell a user their clock is wrong,
 * not just a corrected timestamp. Positive means the local clock is BEHIND the server.
 */
export function getServerTimeOffsetMs(): number {
  return serverTimeOffsetMs;
}

/**
 * Reset offset (e.g. on logout).
 */
export function resetServerTime(): void {
  serverTimeOffsetMs = 0;
}
