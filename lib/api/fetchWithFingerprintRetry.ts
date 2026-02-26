const MAX_FINGERPRINT_RETRIES = 1;

type RefreshFn = (options?: { forceUpdate?: boolean }) => Promise<boolean>;

type RequestFactory = () => Promise<Response>;

type SecurityRetryOptions = {
  refreshClientToken?: () => Promise<boolean>;
  maxAttempts?: number;
};

export async function fetchWithFingerprintRetry(
  makeRequest: RequestFactory,
  refreshFingerprint: RefreshFn,
  options: SecurityRetryOptions = {}
): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? MAX_FINGERPRINT_RETRIES + 1);

  const buildNetworkErrorResponse = (error: unknown) => {
    const message =
      error instanceof Error ? error.message : 'Network request failed';
    return new Response(
      JSON.stringify({
        success: false,
        code: 'NETWORK_ERROR',
        message
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  };

  const isRetriableNetworkError = (error: unknown): boolean => {
    if (!error) return false;
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true;
    }
    if (error instanceof TypeError && /Failed to fetch/i.test(error.message || '')) {
      return true;
    }
    return false;
  };

  const runAttempt = async (attempt: number): Promise<Response> => {
    let response: Response;
    try {
      response = await makeRequest();
    } catch (error) {
      const canRetry = attempt < maxAttempts - 1 && isRetriableNetworkError(error);
      if (canRetry) {
        return runAttempt(attempt + 1);
      }
      if (isRetriableNetworkError(error)) {
        return buildNetworkErrorResponse(error);
      }
      throw error;
    }

    if (attempt >= maxAttempts - 1) {
      return response;
    }

    let code: string | undefined;
    if (response.status === 403 || response.status === 409) {
      try {
        const data = await response.clone().json();
        code = typeof data?.code === 'string' ? data.code : undefined;
      } catch {
        code = undefined;
      }
    }

    const needsFingerprintRefresh =
      (response.status === 409 || response.status === 403) &&
      (code === 'DEVICE_FINGERPRINT_REFRESH' || code === 'DEVICE_MISMATCH');

    if (needsFingerprintRefresh) {
      const refreshed = await refreshFingerprint({ forceUpdate: true });
      if (refreshed) {
        return runAttempt(attempt + 1);
      }
    }

    const refreshClientToken = options.refreshClientToken;
    const needsClientTokenRefresh =
      response.status === 403 &&
      refreshClientToken &&
      (code === 'INVALID_CLIENT_TOKEN' || code === 'MISSING_CLIENT_TOKEN');

    if (needsClientTokenRefresh) {
      const refreshed = await refreshClientToken();
      if (refreshed) {
        return runAttempt(attempt + 1);
      }
    }

    return response;
  };

  return runAttempt(0);
}
