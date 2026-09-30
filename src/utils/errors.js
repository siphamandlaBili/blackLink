/**
 * Errors the API returns on purpose. The central error handler turns these into
 * `{ error: { code, message, details? } }` with the matching HTTP status.
 */
export class AppError extends Error {
  /**
   * @param {number} status HTTP status code.
   * @param {string} code   Stable machine-readable code, e.g. "NOT_FOUND".
   * @param {string} message Human-readable explanation, safe to show.
   * @param {unknown} [details]
   */
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message = 'Bad request', details) => new AppError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Sign in to continue') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = "You don't have permission to do that") => new AppError(403, 'FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message, details) => new AppError(409, 'CONFLICT', message, details);
export const tooMany = (message = 'Too many requests, please slow down') => new AppError(429, 'RATE_LIMITED', message);
