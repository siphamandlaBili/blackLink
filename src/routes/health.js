import { Router } from 'express';
import { dbStatus } from '../config/db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

/**
 * GET /api/health — liveness plus database connectivity. 200 when everything is up,
 * 503 when the database is unreachable (so Render and uptime monitors notice).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const db = await dbStatus();
    const ok = db === 'up';
    res.status(ok ? 200 : 503).json({
      data: { status: ok ? 'ok' : 'degraded', db, uptimeSeconds: Math.round(process.uptime()), time: new Date().toISOString() },
    });
  }),
);

export default router;
