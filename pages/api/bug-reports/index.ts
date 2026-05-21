import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { CommonErrors, ErrorCodes, createApiError, handleApiError } from '../../../lib/api-errors';
import { sendBugReportNotification, BugReportDoc } from '../../../lib/discordBugReportNotifier';
import fs from 'fs';
import path from 'path';

// Rate limiting: 5 reports per hour per wallet
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

const VALID_CATEGORIES = ['UI', 'Rewards', 'Devices', 'Auth', 'Performance', 'Other'] as const;

interface BugReportRequestBody {
  title?: string;
  category?: string;
  description?: string;
  screenshotPreUploaded?: string;
  consoleLogPreUploaded?: string;
  harFilePreUploaded?: string;
}

// Validate filename format (timestamp-random.ext)
function isValidFilename(filename: string | undefined): boolean {
  if (!filename || typeof filename !== 'string') return false;
  return /^\d+-[a-f0-9]+\.(har|log|png)$/.test(filename);
}

// Lazy cleanup - runs after response is sent
async function runLazyCleanup() {
  const filesDir = '/app/uploads/bug-reports/files';
  const chunksDir = '/app/uploads/bug-reports/chunks';
  const now = Date.now();
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  const oneHourMs = 60 * 60 * 1000;

  try {
    // Clean old files (30 days)
    if (fs.existsSync(filesDir)) {
      const files = fs.readdirSync(filesDir);
      for (const file of files) {
        try {
          const filePath = path.join(filesDir, file);
          const stat = fs.statSync(filePath);
          if (now - stat.mtimeMs > thirtyDaysMs) {
            fs.unlinkSync(filePath);
          }
        } catch (e) {
          // Ignore individual file errors
        }
      }
    }

    // Clean stale chunks (1 hour)
    if (fs.existsSync(chunksDir)) {
      const uploadDirs = fs.readdirSync(chunksDir);
      for (const uploadId of uploadDirs) {
        try {
          const uploadPath = path.join(chunksDir, uploadId);
          const stat = fs.statSync(uploadPath);
          if (now - stat.mtimeMs > oneHourMs) {
            // Remove entire upload directory
            fs.rmSync(uploadPath, { recursive: true, force: true });
          }
        } catch (e) {
          // Ignore individual directory errors
        }
      }
    }
  } catch (error) {
    console.warn('[bug-reports] Lazy cleanup error:', error);
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Method not allowed', 'Use POST')
    );
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const walletAddress = session.user.address;

  const body = req.body as BugReportRequestBody;
  const { title, category, description, screenshotPreUploaded, consoleLogPreUploaded, harFilePreUploaded } = body;

  // Validate title
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Title is required', 'Please provide a brief title')
    );
  }
  if (title.length > 100) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Title is too long', 'Maximum 100 characters')
    );
  }

  // Validate category
  if (!category || !VALID_CATEGORIES.includes(category as any)) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Invalid category', `Must be one of: ${VALID_CATEGORIES.join(', ')}`)
    );
  }

  // Validate description
  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Description is required', 'Please describe the issue')
    );
  }
  if (description.length > 2000) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Description is too long', 'Maximum 2000 characters')
    );
  }

  // Validate required files
  if (!consoleLogPreUploaded || !isValidFilename(consoleLogPreUploaded)) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Console log is required', 'Please attach your console log file')
    );
  }
  if (!harFilePreUploaded || !isValidFilename(harFilePreUploaded)) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'HAR file is required', 'Please attach your HAR file')
    );
  }

  // Validate optional screenshot
  if (screenshotPreUploaded && !isValidFilename(screenshotPreUploaded)) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Invalid screenshot filename', 'Please try uploading again')
    );
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');
    const collection = db.collection('bug-reports');
    const usersCollection = db.collection('registration-users');

    // Rate limiting check
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentReports = await collection.countDocuments({
      walletAddress,
      createdAt: { $gte: windowStart }
    });

    if (recentReports >= RATE_LIMIT_MAX) {
      return res.status(429).json(
        createApiError(
          ErrorCodes.RATE_LIMIT_EXCEEDED,
          'Bug report limit reached',
          `You can submit up to ${RATE_LIMIT_MAX} bug reports per hour. Try again later.`
        )
      );
    }

    // Look up Discord username
    const user = await usersCollection.findOne({ address: walletAddress });
    const discordUsername = user?.discordUsername || null;

    // Build document
    const doc: BugReportDoc = {
      walletAddress,
      discordUsername,
      title: title.trim(),
      category,
      description: description.trim(),
      screenshot: screenshotPreUploaded
        ? `/api/uploads/bug-reports/files/${screenshotPreUploaded}`
        : null,
      consoleLog: `/api/uploads/bug-reports/files/${consoleLogPreUploaded}`,
      harFile: `/api/uploads/bug-reports/files/${harFilePreUploaded}`,
      createdAt: new Date(),
      status: 'open'
    };

    // Save to MongoDB
    const result = await collection.insertOne(doc);
    doc._id = result.insertedId;

    // Send Discord notification (non-blocking)
    sendBugReportNotification(doc).catch(err => {
      console.error('[bug-reports] Discord notification failed:', err);
    });

    // Send response immediately
    res.status(200).json({ success: true });

    // Run lazy cleanup after response
    setImmediate(runLazyCleanup);
  } catch (error) {
    handleApiError(res, '/api/bug-reports', error, {
      walletAddress,
      issueType: 'BUG_REPORT_SUBMISSION_ERROR',
      part: 'bug-reports.handler'
    });
  }
}
