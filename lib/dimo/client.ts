import { getDimoConfig, hashDimoId, NormalizedSubscription } from './config';
import { verifyDimoUserJwt } from './jwt';

type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  id_token?: string;
};

const parseDate = (value: any): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return undefined;
  return parsed;
};

export type DimoAccount = {
  id: string;
  email?: {
    address?: string;
    confirmedAt?: string;
  } | null;
  wallet?: {
    address?: string;
  } | null;
  referral?: {
    code?: string;
  } | null;
  countryCode?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export const fetchDimoAccount = async (accessToken: string): Promise<DimoAccount> => {
  const config = getDimoConfig();
  const response = await fetch(`${config.apiBase.replace(/\/$/, '')}/account/v2`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    const error = new Error(`Failed to load DIMO account (${response.status})`);
    // Preserve the HTTP status so callers can decide whether to recover (ex: 404 fallback).
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  return (await response.json()) as DimoAccount;
};

/**
 * Exchanges an authorization code for an access token against the DIMO token endpoint.
 */
export const exchangeDimoCode = async (code: string): Promise<TokenResponse> => {
  const config = getDimoConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });

  if (!response.ok) {
    throw new Error(`Failed to exchange DIMO code (${response.status})`);
  }

  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) {
    throw new Error('DIMO token response missing access_token');
  }
  return data;
};

/**
 * Fetches subscriptions for the authenticated DIMO user.
 * Shape is normalized so eligibility logic can run without leaking PII.
 */
export const fetchDimoSubscriptions = async (
  accessToken: string,
  fallbackUserId?: string
): Promise<NormalizedSubscription[]> => {
  const config = getDimoConfig();
  // Try the canonical endpoint first; fall back to known variants for 404-only mismatches.
  const base = config.apiBase.replace(/\/$/, '');
  const origin = (() => {
    try {
      return new URL(base).origin;
    } catch {
      return base;
    }
  })();
  // Prefer origin paths when apiBase includes a path segment (ex: /api).
  const preferOrigin = (() => {
    try {
      return new URL(base).pathname.startsWith('/api');
    } catch {
      return false;
    }
  })();
  // Include origin-based fallbacks in case apiBase contains a path segment (ex: /api).
  const candidateUrls = Array.from(
    new Set([
      ...(preferOrigin && origin && origin !== base
        ? [`${origin}/subscription/status/all`, `${origin}/subscriptions/status/all`]
        : []),
      `${base}/subscription/status/all`,
      `${base}/subscriptions/status/all`,
      ...(base.endsWith('/api')
        ? []
        : [
            `${base}/api/subscription/status/all`,
            `${base}/api/subscriptions/status/all`
          ]),
      ...(origin && origin !== base && !preferOrigin
        ? [`${origin}/subscription/status/all`, `${origin}/subscriptions/status/all`]
        : [])
    ])
  );

  let response: Response | null = null;
  let lastStatus = 0;
  let lastUrl = candidateUrls[0] ?? base;
  const attempts: Array<{ url: string; status?: number }> = [];

  for (const url of candidateUrls) {
    lastUrl = url;
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });
    attempts.push({ url, status: response.status });
    if (response.ok) break;
    lastStatus = response.status;
    // Retry only on 404; other errors should surface immediately.
    if (response.status !== 404) break;
  }

  if (!response || !response.ok) {
    const status = response?.status ?? lastStatus;
    let snippet = '';
    if (response) {
      try {
        const rawText = await response.clone().text();
        snippet = rawText.trim().slice(0, 500);
      } catch {
        snippet = '';
      }
    }
    const error = new Error(`Failed to load DIMO subscriptions (${status})`);
    // Preserve status + endpoint for diagnostics in logs.
    (error as Error & { status?: number; endpoint?: string; responseSnippet?: string; attempts?: Array<{ url: string; status?: number }> }).status = status;
    (error as Error & { status?: number; endpoint?: string; responseSnippet?: string; attempts?: Array<{ url: string; status?: number }> }).endpoint = lastUrl;
    (error as Error & { status?: number; endpoint?: string; responseSnippet?: string; attempts?: Array<{ url: string; status?: number }> }).responseSnippet = snippet;
    // Include attempted URLs and statuses for diagnostics.
    (error as Error & { status?: number; endpoint?: string; responseSnippet?: string; attempts?: Array<{ url: string; status?: number }> }).attempts = attempts;
    throw error;
  }

  const data = (await response.json()) as any;
  const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];

  return items
    .map((item) => {
      const device = item.device ?? {};
      const vehicle = device.vehicle ?? {};
      const manufacturer = device.manufacturer ?? {};
      // Prefer explicit ids; if absent, fall back to a deterministic hash so claims remain unique.
      let subscriptionId =
        item.stripe_id ?? item.connectionId ?? item.subscriptionId ?? item.id ?? '';
      if (!subscriptionId) {
        const fallbackSig = hashDimoId(
          [
            fallbackUserId ?? 'unknown',
            item.plan ?? item.interval ?? item.type ?? 'unknown',
            item.status ?? 'unknown',
            item.start_date ?? item.started_at ?? item.startDate ?? item.createdAt ?? item.created_at ?? 'unknown',
            item.next_renewal_date ?? item.renewalAt ?? item.renewal_at ?? item.next_billing_at ?? 'unknown',
            item.price ?? 'unknown'
          ].join('|'),
          config.hashSecret
        );
        subscriptionId = `dimo-${fallbackSig.slice(0, 24)}`;
      }
      // User identifier is not present in the sample; use payload if present or fallback to account id.
      const userId = item.userId ?? item.user_id ?? item.ownerId ?? item.owner_id ?? fallbackUserId ?? '';
      const planRaw = (item.plan ?? item.interval ?? item.type ?? 'unknown').toString().toLowerCase();
      // Preserve trial end so eligibility can treat trialing_incomplete as active when future-dated.
      const trialEndsAt = parseDate(item.trial_end ?? item.trialEnd ?? item.trialEndsAt);
      return {
        subscriptionId,
        userId,
        plan: planRaw,
        status: (item.status ?? 'unknown').toString().toLowerCase(),
        startedAt: parseDate(item.start_date ?? item.startedAt ?? item.startDate ?? item.createdAt ?? item.created_at) ?? new Date(),
        renewalAt: parseDate(item.next_renewal_date ?? item.renewalAt ?? item.renewal_at ?? item.next_billing_at) ?? null,
        trialEndsAt: trialEndsAt ?? null,
        deviceAddress: device.address ?? null,
        deviceTokenId: device.tokenId ?? null,
        deviceTokenDid: device.tokenDID ?? null,
        deviceSerial: device.serial ?? null,
        vehicleTokenId: vehicle.tokenId ?? null,
        vehicleDefinition: vehicle.definition ?? null,
        deviceClaimedAt: parseDate(device.claimedAt) ?? null,
        deviceManufacturer: manufacturer.name ?? null,
        raw: item
      };
    }) as NormalizedSubscription[];
};

/**
 * Validates a DIMO UserJWT and fetches subscription status using that token.
 * To be fully wired once we receive the exact response shape.
 */
export const verifyAndFetchSubscriptions = async (
  userJwt: string
): Promise<{ decoded: any; account: DimoAccount; subscriptions: NormalizedSubscription[] }> => {
  const decoded = await verifyDimoUserJwt(userJwt);
  let account: DimoAccount;
  try {
    account = await fetchDimoAccount(userJwt);
  } catch (error) {
    const status = (error as { status?: number })?.status;
    const fallbackUserId =
      typeof decoded?.sub === 'string'
        ? decoded.sub
        : typeof decoded?.wallet === 'string'
          ? decoded.wallet
          : typeof decoded?.email === 'string'
            ? decoded.email
            : '';
    // Allow sync to continue when the account endpoint returns 404 but the JWT is valid.
    if (status === 404 && fallbackUserId) {
      account = { id: fallbackUserId };
    } else {
      throw error;
    }
  }
  let subs: NormalizedSubscription[];
  try {
    subs = await fetchDimoSubscriptions(userJwt, account?.id);
  } catch (error) {
    // Attach verified JWT claims so callers can emit helpful diagnostics without logging the token.
    (error as Error & { dimoDecoded?: unknown }).dimoDecoded = decoded;
    throw error;
  }
  return { decoded, account, subscriptions: subs };
};
