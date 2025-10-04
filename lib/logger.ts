import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import path from 'path';

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

// Define transports
const transports = [
  // Console transport for Docker logs
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.json()
    ),
  }),
  
  // Daily rotate file for all logs
  new DailyRotateFile({
    filename: path.join(process.cwd(), 'logs', 'combined-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    maxSize: '20m',
    maxFiles: '14d',
    format,
  }),
  
  // Daily rotate file for error logs only
  new DailyRotateFile({
    filename: path.join(process.cwd(), 'logs', 'error-%DATE%.log'),
    datePattern: 'YYYY-MM-DD',
    level: 'error',
    maxSize: '20m',
    maxFiles: '14d',
    format,
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
  defaultMeta: { service: 'user-dashboard' },
});

// Helper methods for common logging patterns
export const loggers = {
  // API request logging
  apiRequest: (endpoint: string, method: string, metadata?: object) => {
    logger.info('API Request', { endpoint, method, ...metadata });
  },

  // API error logging
  apiError: (endpoint: string, error: Error | unknown, metadata?: object) => {
    logger.error('API Error', {
      endpoint,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ...metadata,
    });
  },

  // Database operation logging
  dbOperation: (operation: string, collection: string, metadata?: object) => {
    logger.info('Database Operation', { operation, collection, ...metadata });
  },

  // Blockchain transaction logging
  txnLog: (operation: string, txId?: string, metadata?: object) => {
    logger.info('Blockchain Transaction', { operation, txId, ...metadata });
  },

  // Stake operation logging
  stakeOperation: (
    operation: string,
    miner_key: string,
    metadata?: object
  ) => {
    logger.info('Stake Operation', { operation, miner_key, ...metadata });
  },

  // User action logging
  userAction: (action: string, address: string, metadata?: object) => {
    logger.info('User Action', { action, address, ...metadata });
  },
};

export default logger;
