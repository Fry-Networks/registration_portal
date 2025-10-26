import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { notifyDiscordError } from './discord-webhook';
import {
  ErrorLogMetadata,
  NormalizedErrorLogDetails,
} from './logger.types';

// Log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Log colors for console (not used in production)
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

// Determine log level based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'info';
};

// Define log format
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

const transports: winston.transport[] = [
  // Always log to console so we still see output in serverless envs
  new winston.transports.Console({
    format: winston.format.combine(winston.format.json()),
  }),
];

const shouldUseFileLogs = process.env.LOG_TO_FILE !== 'false';
if (shouldUseFileLogs) {
  const logDir = path.join(process.cwd(), 'logs');

  const createFileTransports = (dir: string) => [
    new DailyRotateFile({
      filename: path.join(dir, 'combined-%DATE%.json'),
      datePattern: 'YYYY-MM-DD',
      maxSize: '20m',
      maxFiles: '14d',
      format,
    }),
    new DailyRotateFile({
      filename: path.join(dir, 'error-%DATE%.json'),
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: '20m',
      maxFiles: '14d',
      format,
    }),
  ];

  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.accessSync(logDir, fs.constants.W_OK);

    transports.push(...createFileTransports(logDir));
  } catch (error) {
    console.warn(
      'Logger: primary logs directory not writable, attempting fallback.',
      error instanceof Error ? error.message : error
    );

    try {
      const fallbackDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fry-logs-'));
      transports.push(...createFileTransports(fallbackDir));
      console.warn(`Logger: using fallback log directory ${fallbackDir}`);
    } catch (fallbackError) {
      console.warn(
        'Logger: disabling file transports after fallback failure.',
        fallbackError instanceof Error ? fallbackError.message : fallbackError
      );
    }
  }
}

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
  defaultMeta: { service: 'user-dashboard' },
});

function normalizeString(value?: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeErrorMetadata(
  metadata: ErrorLogMetadata = {}
): NormalizedErrorLogDetails & { detailMessage?: string } {
  const arrayToValue = (input?: unknown): string | undefined => {
    if (Array.isArray(input) && input.length > 0) {
      return normalizeString(input[0]);
    }
    return undefined;
  };

  const minerKey =
    normalizeString(metadata.minerKey) ||
    normalizeString(metadata.miner_key) ||
    arrayToValue(metadata.miner_keys) ||
    'UNKNOWN_MINER_KEY';

  const walletAddress =
    normalizeString(metadata.walletAddress) ||
    normalizeString(metadata.address) ||
    arrayToValue(metadata.walletAddresses) ||
    arrayToValue(metadata.wallet_addresses) ||
    'UNKNOWN_WALLET_ADDRESS';

  const issueType =
    normalizeString(metadata.issueType) ||
    normalizeString(metadata.errorType) ||
    'API_ERROR';

  const part =
    normalizeString(metadata.part) ||
    normalizeString(metadata.step) ||
    normalizeString(metadata.section) ||
    'general';

  const detailMessage =
    normalizeString(metadata.detail) ||
    normalizeString(metadata.message);

  const { minerKey: _1, miner_key: _2, walletAddress: _3, address: _4, issueType: _5, errorType: _6, part: _7, step: _8, detail: _9, message: _10, ...raw } =
    metadata;
  const cleanedRaw = Object.fromEntries(
    Object.entries(raw ?? {}).filter(([, value]) => value !== undefined)
  );

  return {
    minerKey,
    walletAddress,
    issueType,
    part,
    detailMessage,
    rawMetadata: cleanedRaw,
  };
}

function logApiRequest(endpoint: string, method: string, metadata?: object) {
  logger.info('API Request', { endpoint, method, ...metadata });
}

function logApiError(
  endpoint: string,
  error: Error | unknown,
  metadata?: ErrorLogMetadata
) {
  const normalized = normalizeErrorMetadata(metadata);
  const timestamp = new Date().toISOString();
  const errorMessage =
    error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  const payload: Record<string, unknown> = {
    endpoint,
    error: errorMessage,
    stack,
    timestamp,
    minerKey: normalized.minerKey,
    walletAddress: normalized.walletAddress,
    issueType: normalized.issueType,
    part: normalized.part,
    ...normalized.rawMetadata,
  };

  if (normalized.detailMessage && !payload['detail']) {
    payload['detail'] = normalized.detailMessage;
  }

  logger.error('API Error', payload);

  const discordMessage =
    normalized.detailMessage && normalized.detailMessage !== errorMessage
      ? `${normalized.detailMessage}\n\nError: ${errorMessage}`
      : errorMessage;

  // Fire-and-forget to avoid blocking request lifecycle; errors are handled inside helper
  void notifyDiscordError({
    minerKey: normalized.minerKey,
    walletAddress: normalized.walletAddress,
    issueType: normalized.issueType,
    part: normalized.part,
    errorMessage: discordMessage,
    endpoint,
    metadata: { ...normalized.rawMetadata, timestamp },
    timestamp,
  });
}

function logScriptError(
  scriptName: string,
  error: Error | unknown,
  metadata?: ErrorLogMetadata
) {
  const enrichedMetadata: ErrorLogMetadata = {
    ...metadata,
    issueType: metadata?.issueType ?? 'SCRIPT_RUNTIME_ERROR',
    part: metadata?.part ?? scriptName,
  };

  logApiError(`/scripts/${scriptName}`, error, enrichedMetadata);
}

function logDbOperation(operation: string, collection: string, metadata?: object) {
  logger.info('Database Operation', { operation, collection, ...metadata });
}

function logTxn(operation: string, txId?: string, metadata?: object) {
  logger.info('Blockchain Transaction', { operation, txId, ...metadata });
}

function logStakeOperation(
  operation: string,
  miner_key: string,
  metadata?: object
) {
  logger.info('Stake Operation', { operation, miner_key, ...metadata });
}

function logUserAction(action: string, address: string, metadata?: object) {
  logger.info('User Action', { action, address, ...metadata });
}

// Helper methods for common logging patterns
export const loggers = {
  apiRequest: logApiRequest,
  apiError: logApiError,
  scriptError: logScriptError,
  dbOperation: logDbOperation,
  txnLog: logTxn,
  stakeOperation: logStakeOperation,
  userAction: logUserAction,
};

export default logger;
