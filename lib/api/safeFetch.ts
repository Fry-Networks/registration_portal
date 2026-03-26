/**
 * Safe fetch wrapper that validates response.ok before parsing JSON.
 * Prevents crashes from non-JSON responses (HTML error pages, 502s, etc.)
 */
export async function safeFetch<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Safe fetch that returns null on failure instead of throwing.
 * Use when you want to gracefully handle errors inline.
 */
export async function safeFetchOrNull<T = unknown>(
  url: string,
  options?: RequestInit
): Promise<T | null> {
  try {
    return await safeFetch<T>(url, options);
  } catch {
    return null;
  }
}
