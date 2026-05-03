/**
 * HardwareAPI metric resolver — server-only.
 * Code-ready but disabled until endpoint mapping is confirmed.
 */

import { safeFetch } from '../api/safeFetch';

export type HardwareMetricType = 'aem_count' | 'device_count';

export interface HardwareMetricResult {
  ok: boolean;
  wallets?: Array<{ wallet: string; score: number }>;
  errorCode?: string;
  errorMessage?: string;
}

const HARDWAREAPI_BASE_URL = process.env.HARDWAREAPI_BASE_URL;
const HARDWAREAPI_BEARER_TOKEN = process.env.HARDWAREAPI_BEARER_TOKEN;

/**
 * Resolve auto-metric scores from HardwareAPI for a date window.
 * Returns controlled errors if not configured or endpoint unconfirmed.
 */
export async function resolveHardwareMetric(
  metricType: HardwareMetricType,
  _startDate: Date,
  _endDate: Date
): Promise<HardwareMetricResult> {
  if (!HARDWAREAPI_BASE_URL || !HARDWAREAPI_BEARER_TOKEN) {
    return {
      ok: false,
      errorCode: 'HARDWAREAPI_NOT_CONFIGURED',
      errorMessage: 'HardwareAPI is not configured. Set HARDWAREAPI_BASE_URL and HARDWAREAPI_BEARER_TOKEN.',
    };
  }

  // ZEUS00 endpoint mapping is UNCONFIRMED.
  // Do not attempt live calls until a safe read-only endpoint for wallet-level
  // AEM/device counts is verified.
  return {
    ok: false,
    errorCode: 'HARDWAREAPI_ENDPOINT_UNCONFIRMED',
    errorMessage: 'HardwareAPI endpoint mapping is unconfirmed. Auto-metric refresh is disabled.',
  };

  // When endpoint is confirmed, replace the above with something like:
  //
  // const endpoint = metricType === 'aem_count'
  //   ? '/v1/metrics/aem_count'
  //   : '/v1/metrics/device_count';
  // const url = new URL(endpoint, HARDWAREAPI_BASE_URL);
  // url.searchParams.set('start', startDate.toISOString());
  // url.searchParams.set('end', endDate.toISOString());
  //
  // const controller = new AbortController();
  // const timeout = setTimeout(() => controller.abort(), 15000);
  // try {
  //   const data = await safeFetch<any>(url.toString(), {
  //     headers: { Authorization: `Bearer ${HARDWAREAPI_BEARER_TOKEN}` },
  //     signal: controller.signal,
  //   });
  //   // Transform data.wallets or similar into { wallet, score }[]
  //   return { ok: true, wallets: data.wallets ?? [] };
  // } catch (err) {
  //   return {
  //     ok: false,
  //     errorCode: 'HARDWAREAPI_REFRESH_FAILED',
  //     errorMessage: err instanceof Error ? err.message : 'Unknown HardwareAPI error',
  //   };
  // } finally {
  //   clearTimeout(timeout);
  // }
}
