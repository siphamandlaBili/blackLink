import mongoose from 'mongoose';
import { ZodError } from 'zod';
import { isProd } from '../config/env.js';
import { AppError } from '../utils/errors.js';

/** 404 for any route that nothing matched. */
export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

/** Maps known error types to { status, code, message, details }. Unknown errors become a 500. */
function normalise(err) {
  if (err instanceof AppError) return { status: err.status, code: err.code, message: err.message, details: err.details };
  if (err instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Some fields are missing or invalid',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  if (err instanceof mongoose.Error.CastError) return { status: 400, code: 'BAD_REQUEST', message: `Invalid ${err.path}` };
  if (err instanceof mongoose.Error.ValidationError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'Some fields are missing or invalid',
      details: Object.values(err.errors).map((e) => ({ path: e.path, message: e.message })),
    };
  }
  if (err?.code === 11000) {
    return { status: 409, code: 'CONFLICT', message: 'That already exists', details: { fields: Object.keys(err.keyPattern ?? {}) } };
  }
  // Body parser errors carry an HTTP status and a type.
  if (err?.type === 'entity.too.large') return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
  if (err?.type === 'entity.parse.failed') return { status: 400, code: 'INVALID_JSON', message: 'Request body is not valid JSON' };
  if (err?.message?.startsWith('CORS')) return { status: 403, code: 'CORS_REJECTED', message: 'Origin not allowed' };
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Something went wrong on our side' };
}

/** The one place errors are turned into responses. Keep it last in the middleware chain. */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const { status, code, message, details } = normalise(err);
  if (status >= 500) req.log?.error({ err }, 'Unhandled error');
  else req.log?.info({ code, status }, 'Request rejected');

  const body = { error: { code, message } };
  if (details !== undefined) body.error.details = details;
  // Stack traces help locally; never send them in production.
  if (!isProd && status >= 500) body.error.stack = err?.stack;
  res.status(status).json(body);
}
