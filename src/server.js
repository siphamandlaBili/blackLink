import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { syncIndexes } from './models/index.js';
import { logger } from './utils/logger.js';

const SHUTDOWN_TIMEOUT_MS = 10000;

const MAILBOX_DOMAINS = /@((gmail|googlemail|yahoo|outlook|hotmail|live|icloud)\.com|(webmail|mweb)\.co\.za|telkomsa\.net)>?\s*$/i;

async function main() {
  // Resend only sends from verified domains; a public mailbox address means every email fails.
  if (MAILBOX_DOMAINS.test(env.EMAIL_FROM ?? '')) {
    logger.warn('EMAIL_FROM uses a public mailbox domain that Resend cannot send from. Emails will fail until it uses a verified domain (or onboarding@resend.dev for testing).');
  }

  await connectDb();
  // Builds any missing index from the model definitions (idempotent; a no-op when in sync).
  await syncIndexes();

  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening'));

  // Graceful shutdown: stop taking new connections, let in-flight requests finish,
  // then close the database. Render sends SIGTERM on deploys and restarts.
  let closing = false;
  const shutdown = (signal) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    server.close(async () => {
      await disconnectDb().catch((err) => logger.error({ err }, 'Error closing MongoDB'));
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
