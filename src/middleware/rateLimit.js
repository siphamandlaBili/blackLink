import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down' } });

/** Global per-IP limit for the whole API. Stricter limits are added per route in later phases. */
export const globalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler,
});

/**
 * Builds a tighter limiter for sensitive routes (e.g. review creation, tracking).
 * @param {{ windowMs: number, limit: number, keyGenerator?: (req: import('express').Request) => string }} options
 */
export const createLimiter = (options) =>
  rateLimit({ standardHeaders: 'draft-7', legacyHeaders: false, handler, ...options });
