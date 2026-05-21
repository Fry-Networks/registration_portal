import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { CommonErrors, ErrorCodes, createApiError } from '../../../lib/api-errors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const VALID_FIELD_NAMES = ['harFile', 'consoleLog', 'screenshot'] as const;
type FieldName = typeof VALID_FIELD_NAMES[number];

const FIELD_EXTENSIONS: Record<FieldName, string> = {
  harFile: '.har',
  consoleLog: '.log',
  screenshot: '.png'
};

interface FinalizeRequestBody {
  uploadId?: string;
  fieldName?: string;
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

  const body = req.body as FinalizeRequestBody;
  const { uploadId, fieldName } = body;

  // Validate uploadId
  if (!uploadId || typeof uploadId !== 'string' || !/^[a-zA-Z0-9_-]{8,64}$/.test(uploadId)) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Invalid uploadId', 'Must be 8-64 alphanumeric characters')
    );
  }

  // Validate fieldName
  if (!fieldName || !VALID_FIELD_NAMES.includes(fieldName as FieldName)) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Invalid fieldName', `Must be one of: ${VALID_FIELD_NAMES.join(', ')}`)
    );
  }

  const chunkDir = path.join('/app/uploads/bug-reports/chunks', uploadId, fieldName);
  const filesDir = '/app/uploads/bug-reports/files';

  try {
    // Check if chunk directory exists
    if (!fs.existsSync(chunkDir)) {
      return res.status(400).json(
        createApiError(ErrorCodes.INVALID_INPUT, 'No chunks found', 'Upload chunks first')
      );
    }

    // Read all .part files
    const files = fs.readdirSync(chunkDir)
      .filter(f => f.endsWith('.part'))
      .sort((a, b) => {
        const numA = parseInt(a.replace('.part', ''), 10);
        const numB = parseInt(b.replace('.part', ''), 10);
        return numA - numB;
      });

    if (files.length === 0) {
      return res.status(400).json(
        createApiError(ErrorCodes.INVALID_INPUT, 'No chunks found', 'Upload chunks first')
      );
    }

    // Concatenate all chunks
    const buffers: Uint8Array[] = [];
    for (const file of files) {
      const chunkPath = path.join(chunkDir, file);
      const buf = fs.readFileSync(chunkPath);
      buffers.push(new Uint8Array(buf));
    }
    const finalBuffer = Buffer.concat(buffers);

    // Generate filename
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    const ext = FIELD_EXTENSIONS[fieldName as FieldName];
    const filename = `${timestamp}-${random}${ext}`;

    // Ensure files directory exists
    fs.mkdirSync(filesDir, { recursive: true });

    // Write final file
    const finalPath = path.join(filesDir, filename);
    fs.writeFileSync(finalPath, new Uint8Array(finalBuffer));

    // Clean up chunks
    try {
      for (const file of files) {
        fs.unlinkSync(path.join(chunkDir, file));
      }
      fs.rmdirSync(chunkDir);
      
      // Try to remove uploadId directory if empty
      const uploadIdDir = path.join('/app/uploads/bug-reports/chunks', uploadId);
      const remaining = fs.readdirSync(uploadIdDir);
      if (remaining.length === 0) {
        fs.rmdirSync(uploadIdDir);
      }
    } catch (cleanupError) {
      // Non-fatal, just log
      console.warn('[bug-reports/finalize] Cleanup warning:', cleanupError);
    }

    return res.status(200).json({ success: true, filename });
  } catch (error) {
    console.error('[bug-reports/finalize] Error:', error);
    return res.status(500).json(
      createApiError(ErrorCodes.INTERNAL_ERROR, 'Failed to finalize upload', 'Please try again')
    );
  }
}
