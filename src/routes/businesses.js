import { Router } from 'express';
import * as c from '../controllers/businessController.js';
import { asyncHandler as h } from '../middleware/asyncHandler.js';
import { optionalAuth, requireAuth, requireVerifiedEmail } from '../middleware/auth.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { businessCreate, businessPatch, idParams, listQuery, nearbyQuery, slugParams } from '../validators/business.js';

const router = Router();

// Per signed-in user (falls back to IP): stops scripted draft creation and follow spam.
const perUser = (req) => (req.user ? `u:${req.user._id}` : `ip:${req.ip}`);
const createLimit = createLimiter({ windowMs: 60 * 60 * 1000, limit: 10, keyGenerator: perUser });
const engageLimit = createLimiter({ windowMs: 60 * 1000, limit: 60, keyGenerator: perUser });

// Discovery (public; signed-in viewers also get a following flag and personal matches).
router.get('/', optionalAuth, validate({ query: listQuery }), h(c.list));
router.get('/nearby', optionalAuth, validate({ query: nearbyQuery }), h(c.nearby));
router.get('/mine', requireAuth, h(c.mine));

// Onboarding and editing (owner or admin; ownership is checked in the service).
router.post('/', requireAuth, createLimit, validate({ body: businessCreate }), h(c.create));
router.patch('/:id', requireAuth, validate({ params: idParams, body: businessPatch }), h(c.update));
router.delete('/:id', requireAuth, validate({ params: idParams }), h(c.removeDraft));
router.post('/:id/publish', requireAuth, validate({ params: idParams }), h(c.publish));

// Engagement.
router.post('/:id/follow', requireAuth, engageLimit, validate({ params: idParams }), h(c.followBusiness));
router.delete('/:id/follow', requireAuth, engageLimit, validate({ params: idParams }), h(c.unfollowBusiness));
router.post('/:id/vouch', requireAuth, requireVerifiedEmail, engageLimit, validate({ params: idParams }), h(c.vouchBusiness));

// Profile last, so /nearby and /mine aren't read as slugs.
router.get('/:slug', optionalAuth, validate({ params: slugParams }), h(c.profile));

export default router;
