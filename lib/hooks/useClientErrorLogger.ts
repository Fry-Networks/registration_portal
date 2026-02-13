import { useEffect, useRef } from 'react';
import type { Session } from 'next-auth';

const CLIENT_ERROR_ENDPOINT = '/api/logging/client-error';
const CLIENT_ERROR_EVENT = 'fry:client-error';
const DUPLICATE_INTERVAL_MS = 15_000;

declare global {
  interface Window {
    __LAST_MINER_KEY?: string;
  }
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

type ErrorPayload = {
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
  issueType: string;
  part: string;
  reason?: unknown;
  minerKey?: string;
  walletAddress?: string;
  dedupeKey?: string;
};

function recordMinerKey(minerKey?: string | null) {
  if (!minerKey || typeof minerKey !== 'string') {
    return;
  }

  try {
    window.__LAST_MINER_KEY = minerKey;
    sessionStorage.setItem('lastMinerKey', minerKey);
  } catch {
    // Ignore storage errors (private mode, etc.)
  }
}

function extractMinerKey(body: unknown): string | undefined {
  if (!body) {
    return undefined;
  }

  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && 'miner_key' in parsed) {
        const value = (parsed as Record<string, unknown>).miner_key;
        return typeof value === 'string' ? value : undefined;
      }
    } catch {
      // Not JSON
    }

    try {
      const params = new URLSearchParams(body);
      const value = params.get('miner_key');
      if (value) {
        return value;
      }
    } catch {
      // Not URL encoded
    }
  }

  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return body.get('miner_key') ?? undefined;
  }

  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const value = body.get('miner_key');
    return typeof value === 'string' ? value : undefined;
  }

  if (typeof body === 'object' && body !== null) {
    const candidate = (body as Record<string, unknown>).miner_key;
    return typeof candidate === 'string' ? candidate : undefined;
  }

  return undefined;
}

function getLastMinerKey(): string {
  if (typeof window === 'undefined') {
    return 'UNKNOWN_MINER_KEY';
  }

  if (window.__LAST_MINER_KEY) {
    return window.__LAST_MINER_KEY;
  }

  try {
    const stored = sessionStorage.getItem('lastMinerKey');
    if (stored) {
      window.__LAST_MINER_KEY = stored;
      return stored;
    }
  } catch {
    // ignore
  }

  return 'UNKNOWN_MINER_KEY';
}

export type ClientErrorEventDetail = ErrorPayload;

export function emitClientError(detail: ClientErrorEventDetail) {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<ClientErrorEventDetail>(CLIENT_ERROR_EVENT, {
      detail,
    })
  );
}

export function useClientErrorLogger(session: Session | null | undefined) {
  const walletAddress = session?.user?.address ?? null;
  const cacheRef = useRef<Map<string, number>>(new Map());
  const shouldSuppress = (payload: ErrorPayload): boolean => {
    const message = payload?.message ?? '';
    // Suppress noisy client-side polling errors; server-side 5xx still report via API logs.
    const normalizedMessage =
      typeof message === 'string' ? message.toLowerCase() : '';
    if (
      normalizedMessage.includes('failed to fetch prices') ||
      normalizedMessage.includes('usetokenprices') ||
      normalizedMessage.includes('failed to load announcements') ||
      // DIMO SDK postMessage can log "unknown origin" on benign cross-window messages.
      normalizedMessage.includes('received message from an unknown origin') ||
      // NextAuth credentials sign-in rejects are often user cancellations or wallet mismatches.
      normalizedMessage.includes('credentialssignin') ||
      // Algod balance polling failures are expected during transient RPC/network issues.
      normalizedMessage.includes('error fetching balances') ||
      // DIMO popup origin warnings are benign in cross-origin login flows.
      normalizedMessage.includes("origins don't match")
    ) {
      return true;
    }
    const stack = typeof payload?.stack === 'string' ? payload.stack : '';
    const source = typeof payload?.source === 'string' ? payload.source : '';
    const reasonDetails = payload?.reason;
    const reasonStack =
      reasonDetails instanceof Error && typeof reasonDetails.stack === 'string'
        ? reasonDetails.stack
        : typeof reasonDetails === 'string'
          ? reasonDetails
          : '';
    const extensionPattern = /chrome-extension:\/\/|moz-extension:\/\/|safari-extension:\/\//i;
    if (
      extensionPattern.test(source) ||
      extensionPattern.test(stack) ||
      extensionPattern.test(reasonStack)
    ) {
      return true;
    }
    if (typeof message === 'string' && message.toLowerCase().includes('no accounts found')) {
      return true;
    }
    const reason = payload?.reason;
    if (typeof reason === 'string' && reason.toLowerCase().includes('no accounts found')) {
      return true;
    }
    if (reason instanceof Error && reason.message.toLowerCase().includes('no accounts found')) {
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const cache = cacheRef.current;
    const originalConsoleError = console.error.bind(console);
    const originalFetch = window.fetch.bind(window);

    const shouldSkip = (key: string) => {
      const now = Date.now();
      const last = cache.get(key);
      if (last && now - last < DUPLICATE_INTERVAL_MS) {
        return true;
      }
      cache.set(key, now);
      return false;
    };

    const postError = async (payload: ErrorPayload) => {
      try {
        if (shouldSuppress(payload)) {
          return;
        }
        const minerKey = normalizeString(payload.minerKey) ?? getLastMinerKey();
        if (minerKey && minerKey !== 'UNKNOWN_MINER_KEY') {
          recordMinerKey(minerKey);
        }

        const finalWalletAddress =
          normalizeString(payload.walletAddress) ?? walletAddress ?? undefined;

        const finalPayload = {
          message: payload.message,
          stack: payload.stack,
          source: payload.source,
          line: payload.line,
          column: payload.column,
          issueType: payload.issueType,
          part: payload.part,
          reason: payload.reason,
          walletAddress: finalWalletAddress ?? walletAddress,
          minerKey,
          url: window.location.href,
        };

        const cacheKey =
          payload.dedupeKey ?? `${payload.part}|${payload.message}`;
        if (shouldSkip(cacheKey)) {
          return;
        }

        await originalFetch(CLIENT_ERROR_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(finalPayload),
        });
      } catch (error) {
        originalConsoleError(
          '[ClientErrorLogger] Failed to send runtime error',
          error
        );
      }
    };

    const handleWindowError = (event: ErrorEvent) => {
      postError({
        message: event.message || 'Unknown window error',
        stack: event.error?.stack,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        issueType: 'CLIENT_RUNTIME_ERROR',
        part: 'window.error',
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      postError({
        message:
          event.reason instanceof Error
            ? event.reason.message
            : typeof event.reason === 'string'
              ? event.reason
              : 'Unhandled promise rejection',
        stack:
          event.reason instanceof Error ? event.reason.stack : undefined,
        issueType: 'CLIENT_UNHANDLED_REJECTION',
        part: 'window.unhandledrejection',
        reason: event.reason,
      });
    };

    const handleClientEvent = (event: Event) => {
      const detail = (event as CustomEvent<ErrorPayload>).detail;
      if (!detail) {
        return;
      }
      postError(detail);
    };

    const patchedConsoleError: typeof console.error = (...args: unknown[]) => {
      if (args.length > 0) {
        const message =
          args
            .map((arg) => {
              if (typeof arg === 'string') {
                return arg;
              }
              try {
                return JSON.stringify(arg, null, 2);
              } catch {
                return String(arg);
              }
            })
            .join(' ') || 'Console error';

        postError({
          message,
          issueType: 'CLIENT_CONSOLE_ERROR',
          part: 'console.error',
        });
      }

      originalConsoleError(...(args as [unknown, ...unknown[]]));
    };

    const patchedFetch: typeof window.fetch = async (
      input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      try {
        const url =
          typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.toString()
              : input instanceof Request
                ? input.url
                : '';

        if (!url.includes(CLIENT_ERROR_ENDPOINT)) {
          const body = init?.body;
          const minerKey = extractMinerKey(body as unknown);
          recordMinerKey(minerKey);
        }
      } catch {
        // Ignore parsing errors
      }

      return originalFetch(input, init as RequestInit);
    };

    console.error = patchedConsoleError;
    window.fetch = patchedFetch;
    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener(CLIENT_ERROR_EVENT, handleClientEvent as EventListener);

    return () => {
      console.error = originalConsoleError;
      window.fetch = originalFetch;
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener(CLIENT_ERROR_EVENT, handleClientEvent as EventListener);
    };
  }, [walletAddress]);
}
