import { forbidden } from '../utils/errors.js';

/**
 * Use after requireAuth. Admins pass every role check.
 * Route-level guard only: services still check ownership of the specific record.
 * @param {...('owner'|'admin')} roles
 */
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    const role = req.user?.role;
    if (role === 'admin' || roles.includes(role)) return next();
    return next(forbidden());
  };
