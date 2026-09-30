import { randomUUID } from 'node:crypto';

const VALID_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Gives every request an id: reuses a sane incoming X-Request-Id (e.g. from Render's
 * proxy), otherwise makes one. Echoed back in the response header for support tickets.
 */
export function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  res.set('X-Request-Id', req.id);
  next();
}
