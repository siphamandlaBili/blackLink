/**
 * Wraps an async route handler so a rejected promise reaches the central error handler
 * instead of crashing the process or hanging the request.
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => Promise<unknown>} fn
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
