import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { optionalAuth } from '../middleware/auth.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { track, TRACK_EVENTS } from '../services/trackingService.js';
import { objectId } from '../validators/common.js';

const body = z.object({ businessId: objectId, event: z.enum(Object.keys(TRACK_EVENTS)) }).strict();

// Two limits: overall per IP, and per IP per business (so one visitor can't pump one listing).
const perIp = createLimiter({ windowMs: 60 * 1000, limit: 120 });
const perBusiness = createLimiter({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => `${req.ip}:${typeof req.body?.businessId === 'string' ? req.body.businessId.slice(0, 24) : '-'}`,
});

/**
 * POST /api/track { businessId, event } — anonymous engagement counter
 * (view, whatsapp, call, directions, website). 202 whether or not it was counted, so the
 * response doesn't reveal the de-duplication rules.
 */
const router = Router();
router.post(
  '/',
  perIp,
  perBusiness,
  optionalAuth,
  validate({ body }),
  asyncHandler(async (req, res) => {
    await track(req.body, { ip: req.ip, user: req.user });
    res.status(202).json({ data: { received: true } });
  }),
);

export default router;
