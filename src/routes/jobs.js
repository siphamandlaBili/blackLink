import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { env, isTest } from '../config/env.js';
import { JOBS, runJob } from '../jobs/index.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { AppError, notFound } from '../utils/errors.js';

/**
 * POST /api/jobs/:name — runs a scheduled job. Called by GitHub Actions on a timer
 * (.github/workflows/jobs.yml), because Render's free tier sleeps and in-process cron
 * wouldn't fire reliably. Protected by the X-Job-Secret header (constant-time compare).
 * Tests may pass ?now=<ISO> to run a job as of another moment.
 */
function requireJobSecret(req, res, next) {
  const expected = Buffer.from(env.JOB_SECRET ?? '');
  const given = Buffer.from(req.get('x-job-secret') ?? '');
  if (!expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Missing or wrong job secret'));
  }
  return next();
}

const router = Router();
router.post(
  '/:name',
  requireJobSecret,
  validate({
    params: z.object({ name: z.string().max(40) }).strict(),
    query: z.object({ now: z.coerce.date().optional(), force: z.enum(['true']).optional() }).strict(),
  }),
  asyncHandler(async (req, res) => {
    if (!JOBS[req.params.name]) throw notFound(`Unknown job "${req.params.name}". Jobs: ${Object.keys(JOBS).join(', ')}`);
    const { now, force } = req.validatedQuery;
    const result = await runJob(req.params.name, { now: isTest && now ? now : new Date(), force: force === 'true' });
    res.json({ data: result });
  }),
);

export default router;
