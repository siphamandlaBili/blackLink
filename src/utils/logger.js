import pino from 'pino';
import { env, isProd } from '../config/env.js';

/**
 * App logger. Never log personal data: no emails, phone numbers, names, tokens or
 * coordinates. Redaction below is a safety net, not a licence to log bodies.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["svix-signature"]',
      '*.email',
      '*.phone',
      '*.whatsapp',
      '*.password',
      '*.token',
    ],
    censor: '[redacted]',
  },
  ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});
