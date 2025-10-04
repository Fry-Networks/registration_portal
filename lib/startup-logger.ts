import logger from './logger';

export function logStartup() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const port = process.env.PORT || 3007;
  
  logger.info('='.repeat(80));
  logger.info('User Dashboard Starting', {
    application: 'fry-user-dashboard',
    environment: nodeEnv,
    port,
    nodeVersion: process.version,
    platform: process.platform,
    pid: process.pid,
  });
  logger.info('='.repeat(80));
}

export function logDatabaseConnection(status: 'connected' | 'error', error?: Error) {
  if (status === 'connected') {
    logger.info('Database Connected', {
      database: 'MongoDB',
      status: 'connected',
    });
  } else {
    logger.error('Database Connection Failed', {
      database: 'MongoDB',
      status: 'error',
      error: error?.message,
      stack: error?.stack,
    });
  }
}

export function logServerReady(port: number | string) {
  logger.info('Server Ready', {
    status: 'ready',
    port,
    message: `Server listening on port ${port}`,
  });
  logger.info('='.repeat(80));
}
