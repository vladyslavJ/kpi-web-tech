import { createApp } from './app.ts';
import { ConfigError, loadConfig, type AppConfig } from './config.ts';
import { createPinoLogger } from './infrastructure/logging/pino.logger.ts';

const SHUTDOWN_TIMEOUT_MS = 10_000;

loadDotEnvOutsideProduction();
const config = loadConfigOrExit();
const logger = createPinoLogger({ level: config.logLevel, pretty: config.logFormat === 'pretty' });
const app = createApp(config, { logger });

process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', { error });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { error: reason });
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info('Shutting down', { signal });

  setTimeout(() => {
    logger.error('Shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS).unref();

  await app.stop();
  logger.info('Server stopped');
}
process.on('SIGINT', (signal) => void shutdown(signal));
process.on('SIGTERM', (signal) => void shutdown(signal));

const { port } = await app.start();
logger.info('Chat server listening', {
  environment: config.environment,
  port,
  corsOrigins: config.corsOrigins,
  staticDir: config.staticDir ?? null,
  autoMessageIntervalMs: config.autoMessage.intervalMs,
});

function loadDotEnvOutsideProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  try {
    process.loadEnvFile('.env');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

function loadConfigOrExit(): AppConfig {
  try {
    return loadConfig(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
