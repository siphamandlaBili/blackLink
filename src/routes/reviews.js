import { Router } from 'express';
import * as c from '../controllers/reviewController.js';
import { asyncHandler as h } from '../middleware/asyncHandler.js';
import { optionalAuth, requireAuth, requireVerifiedEmail } from '../middleware/auth.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { pageQuery } from '../validators/common.js';
import { businessIdParams, replyBody, reportBody, reviewCreate, reviewIdParams, reviewListQuery, reviewPatch } from '../validators/review.js';
import { z } from 'zod';

const perUser = (req) => (req.user ? `u:${req.user._id}` : `ip:${req.ip}`);
// The 5-per-day rule is enforced in the service; this only stops hammering the endpoint.
const writeLimit = createLimiter({ windowMs: 60 * 60 * 1000, limit: 30, keyGenerator: perUser });
const actionLimit = createLimiter({ windowMs: 60 * 1000, limit: 60, keyGenerator: perUser });

/** Mounted at /api/businesses/:id/reviews */
export const businessReviews = Router({ mergeParams: true });
businessReviews.get('/', optionalAuth, validate({ params: businessIdParams, query: reviewListQuery }), h(c.list));
businessReviews.post('/', requireAuth, requireVerifiedEmail, writeLimit, validate({ params: businessIdParams, body: reviewCreate }), h(c.create));

/** Mounted at /api/reviews */
export const reviews = Router();
reviews.patch('/:id', requireAuth, requireVerifiedEmail, writeLimit, validate({ params: reviewIdParams, body: reviewPatch }), h(c.update));
reviews.delete('/:id', requireAuth, writeLimit, validate({ params: reviewIdParams }), h(c.remove));
// Helpful votes feed the Trust Score, so they need a verified email too.
reviews.post('/:id/helpful', requireAuth, requireVerifiedEmail, actionLimit, validate({ params: reviewIdParams }), h(c.markHelpful));
reviews.delete('/:id/helpful', requireAuth, requireVerifiedEmail, actionLimit, validate({ params: reviewIdParams }), h(c.unmarkHelpful));
reviews.put('/:id/reply', requireAuth, actionLimit, validate({ params: reviewIdParams, body: replyBody }), h(c.reply));
reviews.post('/:id/report', requireAuth, actionLimit, validate({ params: reviewIdParams, body: reportBody }), h(c.report));

/** Mounted at /api/me/reviews */
export const myReviews = Router();
myReviews.get('/', requireAuth, validate({ query: z.object(pageQuery).strict() }), h(c.mine));
