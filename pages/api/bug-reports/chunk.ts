import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import { CommonErrors, ErrorCodes, createApiError } from '../../../lib/api-errors';
import fs from 'fs';
import path from 'path';

// Rate limiting: 50 requests per hour per IP
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 50;
const rateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(ip);
  
  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(ip, { count: 1, windowStart: now });
    return true;
  }
  
  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  record.count++;
  return true;
}

const VALID_FIELD_NAMES = ['harFile', 'consoleLog', 'screenshot'] as const;
type FieldName = typeof VALID_FIELD_NAMES[number];

interface ChunkRequestBody {
  uploadId?: string;
  chunkIndex?: number;
  totalChunks?: number;
  fieldName?: string;
  chunk?: string;
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

  // Rate limiting
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() 
    || req.socket.remoteAddress 
    || 'unknown';
  
  if (!checkRateLimit(ip)) {
    return res.status(429).json(
      createApiError(ErrorCodes.RATE_LIMIT_EXCEEDED, 'Too many chunk uploads', 'Try again later')
    );
  }

  const body = req.body as ChunkRequestBody;
  const { uploadId, chunkIndex, totalChunks, fieldName, chunk } = body;

  // Validate uploadId - strict alphanumeric + dash/underscore, 8-64 chars
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

  // Validate chunkIndex
  if (typeof chunkIndex !== 'number' || chunkIndex < 0 || chunkIndex > 999 || !Number.isInteger(chunkIndex)) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Invalid chunkIndex', 'Must be integer 0-999')
    );
  }

  // Validate totalChunks
  if (typeof totalChunks !== 'number' || totalChunks < 1 || totalChunks > 1000 || !Number.isInteger(totalChunks)) {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Invalid totalChunks', 'Must be integer 1-1000')
    );
  }

  // Validate chunk
  if (!chunk || typeof chunk !== 'string') {
    return res.status(400).json(
      createApiError(ErrorCodes.INVALID_INPUT, 'Missing chunk data', 'Chunk must be a base64 string')
    );
  }

  try {
    // Decode base64 to buffer
    const buffer = Buffer.from(chunk, 'base64');
    
    // Create directory path
    const chunkDir = path.join('/app/uploads/bug-reports/chunks', uploadId, fieldName);
    fs.mkdirSync(chunkDir, { recursive: true });
    
    // Write chunk file
    const chunkPath = path.join(chunkDir, `${chunkIndex}.part`);
    fs.writeFileSync(chunkPath, new Uint8Array(buffer));

    return res.status(200).json({ success: true, received: chunkIndex });
  } catch (error) {
    console.error('[bug-reports/chunk] Error writing chunk:', error);
    return res.status(500).json(
      createApiError(ErrorCodes.INTERNAL_ERROR, 'Failed to save chunk', 'Please try again')
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
