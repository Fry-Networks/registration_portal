import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { CommonErrors, createApiError, ErrorCodes } from '../../../lib/api-errors';
import path from 'path';
import fs from 'fs';

/**
 * Admin-only file download endpoint.
 *
 * Uses nginx X-Accel-Redirect for efficient file serving.
 * Only users with session.user.admin === true can download bug report files.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json(createApiError(ErrorCodes.INVALID_INPUT, 'Method not allowed'));
  }

  // Require authentication
  const session = await getServerSession(req, res, authOptions);
  if (!session?.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  // Require admin
  if (!(session.user as any).admin) {
    return res.status(403).json(
      createApiError(ErrorCodes.UNAUTHORIZED, 'Admin access required', 'Only admins can download bug report files')
    );
  }

  // Get and validate path
  const pathParts = req.query.path;
  if (!pathParts || !Array.isArray(pathParts)) {
    return res.status(400).json(createApiError(ErrorCodes.INVALID_INPUT, 'Invalid path'));
  }

  const filePath = pathParts.join('/');

  // Security: only allow bug-reports/files/ paths, no traversal
  if (!filePath.startsWith('bug-reports/files/') || filePath.includes('..')) {
    return res.status(403).json(createApiError(ErrorCodes.UNAUTHORIZED, 'Invalid file path'));
  }

  // Verify file exists
  const fullPath = path.join('/app/uploads', filePath);
  if (!fs.existsSync(fullPath)) {
    return res.status(404).json(createApiError(ErrorCodes.DEVICE_NOT_FOUND, 'File not found'));
  }

  // Use X-Accel-Redirect for nginx to serve the file
  res.setHeader('X-Accel-Redirect', `/internal-uploads/${filePath}`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.status(200).end();
}
