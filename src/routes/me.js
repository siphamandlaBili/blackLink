import { Router } from 'express';
import { deleteAccount, exportData, getEngagement, getMe, patchPreferences } from '../controllers/meController.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { z } from 'zod';
import { myBusinessCards } from '../services/engagementService.js';
import { myEvents, myHostedEvents } from '../services/eventService.js';
import { deleteAccountBody } from '../validators/admin.js';
import { preferencesBody } from '../validators/me.js';

const router = Router();
router.use(requireAuth);

router.get('/', getMe);
router.get('/engagement', asyncHandler(getEngagement));
// The profile's lists: followed businesses, and events you're going to.
router.get(
  '/businesses',
  validate({ query: z.object({ list: z.enum(['following']) }).strict() }),
  asyncHandler(async (req, res) => res.json({ data: await myBusinessCards(req.user) })),
);
router.get('/events', asyncHandler(async (req, res) => res.json({ data: await myEvents(req.user) })));
router.get('/hosted-events', asyncHandler(async (req, res) => res.json({ data: await myHostedEvents(req.user) })));
router.patch('/preferences', validate({ body: preferencesBody }), asyncHandler(patchPreferences));

// POPIA: data export (a few per hour is plenty) and account deletion.
const exportLimit = createLimiter({ windowMs: 60 * 60 * 1000, limit: 5, keyGenerator: (req) => `u:${req.user._id}` });
router.get('/export', exportLimit, asyncHandler(exportData));
router.delete('/', validate({ body: deleteAccountBody }), asyncHandler(deleteAccount));

export default router;
