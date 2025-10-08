import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import clientPromise from '../../lib/mongoclient';
import { authOptions } from './auth/[...nextauth]';
import { CommonErrors, ErrorCodes, createApiError } from '../../lib/api-errors';
import logger from '../../lib/logger';

const RATE_LIMIT_MAX_REPORTS = 2;
const DEFAULT_RATE_LIMIT_MINUTES = 120;

function getRateLimitWindowMs(): number {
  const minutesEnv = process.env.BUG_REPORT_RATE_LIMIT_MINUTES;
  if (minutesEnv) {
    const parsedMinutes = Number(minutesEnv);
    if (Number.isFinite(parsedMinutes) && parsedMinutes > 0) {
      return parsedMinutes * 60 * 1000;
    }
  }

  const hoursEnv = process.env.BUG_REPORT_RATE_LIMIT_HOURS;
  if (hoursEnv) {
    const parsedHours = Number(hoursEnv);
    if (Number.isFinite(parsedHours) && parsedHours > 0) {
      return parsedHours * 60 * 60 * 1000;
    }
  }

  return DEFAULT_RATE_LIMIT_MINUTES * 60 * 1000;
}
interface BugReportRequestBody {
  message?: string;
  screenshot?: {
    dataUrl?: string;
    mimeType?: string;
    name?: string;
    size?: number;
  };
}

function sanitizeFilename(name?: string): string {
  if (!name) {
    return 'screenshot.png';
  }
  return name.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parseDataUrl(dataUrl?: string) {
  if (!dataUrl || typeof dataUrl !== 'string') {
    return null;
  }

  const matches = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!matches) {
    return null;
  }

  const [, mimeType, base64] = matches;
  if (!mimeType || !base64) {
    return null;
  }

  try {
    const buffer = Buffer.from(base64, 'base64');
    return { buffer, mimeType };
  } catch (error) {
    logger.warn('Failed to parse screenshot data URL', {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

async function sendToDiscord({
  webhookUrl,
  address,
  message,
  screenshot,
  userAgent,
  email
}: {
  webhookUrl: string;
  address: string;
  message: string;
  screenshot?: {
    buffer: Buffer;
    mimeType: string;
    filename: string;
  };
  userAgent?: string | string[];
  email?: string | null;
}) {
  const timestamp = new Date().toISOString();
  const embed = {
    title: 'New Dashboard Bug Report',
    color: 0xff4d4f,
    fields: [
      {
        name: 'Wallet',
        value: `\`${address}\``,
        inline: false
      },
      {
        name: 'Message',
        value: message,
        inline: false
      }
    ],
    footer: {
      text: userAgent ? `User agent: ${typeof userAgent === 'string' ? userAgent : userAgent.join(', ')}` : 'User agent unavailable'
    },
    timestamp
  } as Record<string, any>;

  if (email) {
    embed.fields?.push({
      name: 'Email',
      value: email,
      inline: false
    });
  }

  const payload = {
    username: 'Fry Dashboard Bug Reporter',
    embeds: [embed],
    allowed_mentions: { parse: [] as string[] }
  };

  if (screenshot) {
    embed.image = {
      url: `attachment://${screenshot.filename}`
    };

    const formData = new FormData();
    const fileBlob = new Blob([Uint8Array.from(screenshot.buffer)], {
      type: screenshot.mimeType
    });
    formData.append('payload_json', JSON.stringify(payload));
    formData.append('files[0]', fileBlob, screenshot.filename);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Discord webhook failed (${response.status}): ${text}`);
    }

    return;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Discord webhook failed (${response.status}): ${text}`);
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res
      .status(405)
      .json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Unsupported request method',
          'Please submit bug reports with a POST request'
        )
      );
    return;
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    res.status(401).json(CommonErrors.noSession());
    return;
  }

  const address = session.user.address;
  if (!address) {
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  const { message, screenshot } = (req.body ?? {}) as BugReportRequestBody;

  if (!message || typeof message !== 'string') {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Bug report message is required',
        'Describe the issue you encountered so our team can help'
      )
    );
    return;
  }

  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Bug report cannot be empty',
        'Add details about the issue before submitting'
      )
    );
    return;
  }

  if (trimmedMessage.length > 750) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Bug report is over the 750 character limit',
        'Please shorten your message before submitting'
      )
    );
    return;
  }

  let parsedScreenshot: { buffer: Buffer; mimeType: string; filename: string; size: number } | undefined;
  if (screenshot && screenshot.dataUrl) {
    if (typeof screenshot.size === 'number' && screenshot.size > 4 * 1024 * 1024) {
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Screenshot is too large',
          'Please upload an image that is 4 MB or smaller'
        )
      );
      return;
    }

    const parsed = parseDataUrl(screenshot.dataUrl);
    if (!parsed) {
      res.status(400).json(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'We could not read your screenshot',
          'Please try attaching the image again'
        )
      );
      return;
    }

    parsedScreenshot = {
      buffer: parsed.buffer,
      mimeType: screenshot.mimeType || parsed.mimeType,
      filename: sanitizeFilename(screenshot.name || `screenshot-${Date.now()}.png`),
      size: parsed.buffer.length
    };
  }

  const webhookUrl = process.env.DISCORD_BUG_WEBHOOK_URL;
  if (!webhookUrl) {
    logger.error('DISCORD_BUG_WEBHOOK_URL not configured');
    res.status(500).json(
      createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Bug reporting is not configured',
        'Please contact support while we resolve this issue'
      )
    );
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const testMode =
      process.env.NEXT_PUBLIC_TEST_MODE &&
      process.env.NEXT_PUBLIC_TEST_MODE === 'true';
    const collection = db.collection(testMode ? 'test-bug-reports' : 'bug-reports');

    const rateLimitWindowMs = getRateLimitWindowMs();
    const now = Date.now();
    const windowStart = new Date(now - rateLimitWindowMs);
    const recentReports = await collection
      .find({ address, createdAt: { $gte: windowStart } })
      .sort({ createdAt: 1 })
      .limit(RATE_LIMIT_MAX_REPORTS)
      .toArray();

    if (recentReports.length >= RATE_LIMIT_MAX_REPORTS) {
      const oldest = recentReports[0]?.createdAt
        ? new Date(recentReports[0].createdAt).getTime()
        : now;
      const retryAfterMs = Math.max(0, oldest + rateLimitWindowMs - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      const windowMinutes = Math.round(rateLimitWindowMs / 60000);
      const minutesRemaining = Math.max(1, Math.ceil(retryAfterSeconds / 60));

      res.setHeader('Retry-After', retryAfterSeconds.toString());
      res.status(429).json(
        createApiError(
          ErrorCodes.RATE_LIMIT_EXCEEDED,
          'Bug report limit reached',
          `You can send up to ${RATE_LIMIT_MAX_REPORTS} bug reports every ${windowMinutes} minutes. Try again in about ${minutesRemaining} minute(s).`,
          {
            retryAfterSeconds,
            rateLimitWindowMinutes: windowMinutes,
            rateLimitMax: RATE_LIMIT_MAX_REPORTS
          }
        )
      );
      return;
    }

    await sendToDiscord({
      webhookUrl,
      address,
      message: trimmedMessage,
      screenshot: parsedScreenshot
        ? {
            buffer: parsedScreenshot.buffer,
            mimeType: parsedScreenshot.mimeType,
            filename: parsedScreenshot.filename
          }
        : undefined,
      userAgent: req.headers['user-agent'],
      email: session.user.email ?? null
    });

    await collection.insertOne({
      address,
      message: trimmedMessage,
      createdAt: new Date(),
      screenshot: parsedScreenshot
        ? {
            hasScreenshot: true,
            mimeType: parsedScreenshot.mimeType,
            filename: parsedScreenshot.filename,
            size: parsedScreenshot.size
          }
        : {
            hasScreenshot: false
          },
      meta: {
        userAgent: req.headers['user-agent'] ?? null,
        email: session.user.email ?? null,
        rateLimitWindowMs,
        rateLimitMax: RATE_LIMIT_MAX_REPORTS
      }
    });

    res.status(200).json({ success: true });
  } catch (error) {
    logger.error('Failed to process bug report', {
      address,
      error: error instanceof Error ? error.message : String(error)
    });

    res.status(502).json(
      createApiError(
        ErrorCodes.NETWORK_ERROR,
        'We could not forward your bug report',
        'Please try again in a few minutes'
      )
    );
  }
}

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '6mb'
    }
  }
};
