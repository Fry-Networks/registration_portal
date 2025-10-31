const MAX_FINGERPRINT_RETRIES = 1;

type RefreshFn = () => Promise<boolean>;

type RequestFactory = () => Promise<Response>;

export async function fetchWithFingerprintRetry(
  makeRequest: RequestFactory,
  refreshFingerprint: RefreshFn,
  attempt: number = 0
): Promise<Response> {
  const response = await makeRequest();

  if (response.status === 409 && attempt < MAX_FINGERPRINT_RETRIES) {
    let code: string | undefined;
    try {
      const data = await response.clone().json();
      code = typeof data?.code === 'string' ? data.code : undefined;
    } catch {
      code = undefined;
    }

    if (code === 'DEVICE_FINGERPRINT_REFRESH') {
      const refreshed = await refreshFingerprint();
      if (refreshed) {
        return fetchWithFingerprintRetry(makeRequest, refreshFingerprint, attempt + 1);
      }
    }
  }

  return response;
}
