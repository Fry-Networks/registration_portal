import type { NextApiRequest, NextApiResponse } from 'next';
import path from 'path';
import fs from 'fs';
import { createReadStream } from 'fs';
import { stat } from 'fs/promises';
import { verifySession, COOKIE_NAME } from './auth/callback';

const UPLOAD_BASE = '/app/uploads';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check GitHub session cookie
  const sessionToken = req.cookies?.[COOKIE_NAME];
  const secret = process.env.GITHUB_COOKIE_SECRET;
  const allowedId = process.env.GITHUB_ALLOWED_USER_ID;

  if (!secret || !allowedId) {
    return res.status(500).json({ error: 'GitHub auth not configured' });
  }

  const userId = sessionToken ? verifySession(sessionToken, secret) : null;

  if (!userId || userId !== allowedId) {
    // Redirect to GitHub login, passing current URL as returnTo
    const returnTo = req.url || '/';
    return res.redirect(
      `/api/uploads/auth/login?returnTo=${encodeURIComponent(returnTo)}`
    );
  }

  // Validate file path
  const pathParts = req.query.path;
  if (!pathParts || !Array.isArray(pathParts)) {
    return res.status(400).json({ error: 'Invalid path' });
  }

  const filePath = pathParts.join('/');

  // Security: only allow bug-reports/files/ — no traversal
  if (!filePath.startsWith('bug-reports/files/') || filePath.includes('..')) {
    return res.status(403).json({ error: 'Invalid file path' });
  }

  // Verify file exists
  const fullPath = path.join(UPLOAD_BASE, filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  // Stream file directly
  const fileStat = await stat(fullPath);
  const filename = path.basename(fullPath);

  // Determine Content-Type based on extension
  const ext = path.extname(filename).toLowerCase();
  const contentType =
    ext === '.har' ? 'application/json' :
    ext === '.log' || ext === '.txt' ? 'text/plain' :
    ext === '.png' ? 'image/png' :
    ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' :
    'application/octet-stream';

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Length', fileStat.size);
  res.status(200);

  const stream = createReadStream(fullPath);
  stream.pipe(res);
  stream.on('error', () => {
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to read file' });
    }
  });
  return;
}
