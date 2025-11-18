/**
 * Safari throws when `history.replaceState` or `history.pushState` is invoked >100 times within 10 seconds.
 * Next.js updates the history stack whenever we adjust query params or shallow-route, so a noisy component
 * (e.g., rapid input changes) can trip that guard and surface unhandled rejections. To keep the UX smooth,
 * we throttle redundant history calls in the browser and drop duplicate calls within a tight window.
 */
let historyThrottleInstalled = false;

const MIN_INTERVAL_MS = 250;
const WINDOW_MS = 10_000;
const MAX_CALLS_PER_WINDOW = 90;

type HistoryMethod = 'replaceState' | 'pushState';
type HistoryArgs = Parameters<History['replaceState']>;

const serializeArgs = (state: HistoryArgs[0], url: HistoryArgs[2]) => {
  if (state && typeof state === 'object') {
    const { url: stateUrl, as, options } = state as Record<string, unknown>;
    try {
      return JSON.stringify({
        url: stateUrl ?? url ?? '',
        as: as ?? null,
        scroll: options && typeof options === 'object'
          ? (options as Record<string, unknown>).scroll ?? null
          : null
      });
    } catch {
      // fall through to string version below
    }
  }
  return `${url ?? ''}|${typeof state === 'string' ? state : ''}`;
};

const installThrottleForMethod = (history: History, method: HistoryMethod) => {
  const original = history[method];
  if (typeof original !== 'function') {
    return;
  }

  const bound = original.bind(history);
  let lastKey = '';
  let lastAt = 0;
  let windowStart = 0;
  let windowCount = 0;

  history[method] = ((state, title, url) => {
    const now = Date.now();
    const key = serializeArgs(state, url);

    if (now - windowStart > WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }

    // Drop consecutive identical calls fired within MIN_INTERVAL_MS.
    if (key === lastKey && now - lastAt < MIN_INTERVAL_MS) {
      return;
    }

    // Keep a moving window count so Safari never sees 100+ calls within 10s.
    if (windowCount >= MAX_CALLS_PER_WINDOW) {
      return;
    }

    windowCount += 1;
    lastKey = key;
    lastAt = now;
    return bound(state, title, url);
  }) as History['replaceState'];
};

export const installHistoryReplaceThrottle = () => {
  if (historyThrottleInstalled || typeof window === 'undefined') {
    return;
  }

  const { history } = window;
  if (!history) {
    return;
  }

  installThrottleForMethod(history, 'replaceState');
  installThrottleForMethod(history, 'pushState');
  historyThrottleInstalled = true;
};
