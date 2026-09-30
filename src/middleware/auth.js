import { clerkMiddleware, getAuth } from '@clerk/express';
import { env, isTest } from '../config/env.js';
import { assertActive, findOrCreateByClerkId } from '../services/userService.js';
import { AppError, unauthorized } from '../utils/errors.js';
import { asyncHandler } from './asyncHandler.js';

/**
 * Reads the Clerk session (Authorization: Bearer <token> from the web app's getToken())
 * on every request. It never rejects on its own; requireAuth does that.
 *
 * NODE_ENV=test only: Clerk is replaced by an "X-Test-Clerk-Id" header so the test suite
 * can act as any user without real tokens. env.js refuses to run tests with live keys,
 * and the header is ignored in every other environment.
 */
export const clerkAuth = isTest
  ? (req, res, next) => {
      req.testClerkId = req.get('x-test-clerk-id') || null;
      next();
    }
  : clerkMiddleware({ publishableKey: env.CLERK_PUBLISHABLE_KEY, secretKey: env.CLERK_SECRET_KEY });

/** The Clerk user id for this request, or null when signed out. */
export const clerkIdOf = (req) => (isTest ? req.testClerkId : getAuth(req)?.userId ?? null);

/**
 * Requires a signed-in, active account and attaches it as req.user (lean document).
 * Creates the Mongo user on the fly if the Clerk webhook hasn't arrived yet.
 */
export const requireAuth = asyncHandler(async (req, res, next) => {
  const clerkId = clerkIdOf(req);
  if (!clerkId) throw unauthorized();
  const user = await findOrCreateByClerkId(clerkId);
  assertActive(user);
  req.user = user;
  next();
});

/** Like requireAuth, but carries on as a guest when signed out (req.user stays undefined). */
export const optionalAuth = asyncHandler(async (req, res, next) => {
  const clerkId = clerkIdOf(req);
  if (clerkId) {
    const user = await findOrCreateByClerkId(clerkId);
    if (user?.status === 'active') req.user = user;
  }
  next();
});

/** Use after requireAuth. Reviews and other trust-sensitive actions need a verified email. */
export function requireVerifiedEmail(req, res, next) {
  if (!req.user?.emailVerified) {
    return next(new AppError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address to do this'));
  }
  return next();
}
