import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { signUpload } from '../services/cloudinary.js';

export const UPLOAD_PURPOSES = ['business-logo', 'business-cover', 'business-gallery', 'review-photo', 'post-media', 'event-image'];

const router = Router();
const limit = createLimiter({ windowMs: 60 * 60 * 1000, limit: 60, keyGenerator: (req) => `u:${req.user._id}` });

/**
 * POST /api/uploads/sign — signed parameters for one direct upload to Cloudinary.
 *
 * Flow: 1) call this, 2) POST the file with `fields` to `uploadUrl` (multipart), 3) send
 * `{ publicId }` to the route that uses the image (e.g. PATCH /businesses/:id { cover }).
 * The server then checks the upload is yours, an image and at most 5 MB before using it.
 */
router.post('/sign', requireAuth, limit, validate({ body: z.object({ purpose: z.enum(UPLOAD_PURPOSES) }).strict() }), (req, res) => {
  res.json({ data: signUpload(String(req.user._id), req.body.purpose) });
});

export default router;
