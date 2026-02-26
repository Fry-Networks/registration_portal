export type DiscordSeverity = 'error' | 'warning' | 'info' | 'success';

export interface DiscordErrorDetails {
  minerKey: string;
  walletAddress: string;
  issueType: string;
  part: string;
  errorMessage: string;
  endpoint?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
  severity?: DiscordSeverity;
}

type WebhookPayload = {
  username: string;
  embeds: Array<Record<string, unknown>>;
  allowed_mentions: { parse: string[] };
};

const INITIAL_WEBHOOK_URL =
  process.env.DISCORD_BUG_WEBHOOK_URL?.trim() ||
  process.env.DISCORD_ERROR_WEBHOOK_URL?.trim() ||
  process.env.DISCORD_ALERTS_WEBHOOK_URL?.trim() ||
  '';

let webhookUrl = INITIAL_WEBHOOK_URL;

type RateLimitWindow = {
  windowMs: number;
  max: number;
  timestamps: number[];
};

const RATE_LIMIT_WINDOWS: RateLimitWindow[] = [
  { windowMs: 60_000, max: 20, timestamps: [] }, // 20 per minute
  { windowMs: 3_600_000, max: 300, timestamps: [] }, // 300 per hour
];

const rateLimitStats = {
  dropped: 0,
};

let lastRateLimitLog = 0;

const cleanWindow = (window: RateLimitWindow, now: number) => {
  while (window.timestamps.length > 0 && window.timestamps[0] <= now - window.windowMs) {
    window.timestamps.shift();
  }
};

const tryConsumeRateBudget = (now: number): boolean => {
  let allowed = true;

  for (const window of RATE_LIMIT_WINDOWS) {
    cleanWindow(window, now);
    if (window.timestamps.length >= window.max) {
      allowed = false;
    }
  }

  if (!allowed) {
    return false;
  }

  for (const window of RATE_LIMIT_WINDOWS) {
    window.timestamps.push(now);
  }

  return true;
};

const SEVERITY_STYLES: Record<DiscordSeverity, { title: string; color: number }> = {
  error: { title: 'Dashboard Error Alert', color: 0xff4d4f },
  warning: { title: 'Dashboard Warning', color: 0xfaad14 },
  info: { title: 'Dashboard Event', color: 0x1890ff },
  success: { title: 'Dashboard Success', color: 0x52c41a }
};

function buildEmbed(details: DiscordErrorDetails) {
  const timestamp = details.timestamp ?? new Date().toISOString();
  const {
    minerKey,
    walletAddress,
    issueType,
    part,
    errorMessage,
    endpoint,
    metadata,
    severity = 'error',
  } = details;

  const style = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.error;

  const fields = [
    {
      name: 'Issue Type',
      value: issueType,
      inline: true,
    },
    {
      name: 'Part',
      value: part,
      inline: true,
    },
    {
      name: 'Miner Key',
      value: `\`${minerKey}\``,
      inline: false,
    },
    {
      name: 'Wallet',
      value: `\`${walletAddress}\``,
      inline: false,
    },
  ];

  if (metadata && Object.keys(metadata).length > 0) {
    fields.push({
      name: 'Context',
      value: '```json\n' +
        JSON.stringify(metadata, (_key, value) => {
          if (typeof value === 'string' && value.length > 200) {
            return `${value.slice(0, 200)}…`;
          }
          return value;
        }, 2) +
        '\n```',
      inline: false,
    });
  }

  return {
    title: style.title,
    color: style.color,
    description:
      errorMessage.length > 1024
        ? `${errorMessage.slice(0, 1000)}…`
        : errorMessage,
    fields,
    timestamp,
    footer: endpoint ? { text: endpoint } : undefined,
  };
}

export async function notifyDiscordError(details: DiscordErrorDetails) {
  if (!webhookUrl) {
    return;
  }

  const now = Date.now();
  if (!tryConsumeRateBudget(now)) {
    rateLimitStats.dropped += 1;
    if (now - lastRateLimitLog > 60_000) {
      lastRateLimitLog = now;
      console.warn(
        '[discord-webhook] Rate limit reached, dropping alerts',
        { dropped: rateLimitStats.dropped }
      );
    }
    return;
  }

  try {
    const embed = buildEmbed(details);

    const payload: WebhookPayload = {
      username: 'Fry Dashboard Monitor',
      embeds: [embed],
      allowed_mentions: { parse: [] },
    };

    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // Avoid recursive logging loops by keeping this scoped to console output
    console.warn(
      '[discord-webhook] Failed to send error notification',
      error instanceof Error ? error.message : error
    );
  }
}

export const discordWebhookConfig = {
  isConfigured: Boolean(webhookUrl),
  stats: rateLimitStats,
};

export function __setDiscordWebhookUrlForTests(url: string) {
  webhookUrl = url;
  discordWebhookConfig.isConfigured = Boolean(url);
}

export function __getDiscordWebhookUrlForTests(): string {
  return webhookUrl;
}

export function __resetDiscordRateLimiterForTests() {
  RATE_LIMIT_WINDOWS.forEach((window) => {
    window.timestamps.length = 0;
  });
  rateLimitStats.dropped = 0;
  lastRateLimitLog = 0;
}

// Ensure initial state aligns with env-derived configuration
__setDiscordWebhookUrlForTests(INITIAL_WEBHOOK_URL);
