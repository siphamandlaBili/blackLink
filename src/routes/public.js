import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getActivity, getCategories, getFeatured, getSpotlight, getStats, getTrending } from '../services/publicService.js';

/**
 * Landing page endpoints. Anonymous and cached for 5 minutes in memory (see
 * services/publicService.js); browsers and CDNs may also cache them for a minute.
 */
const router = Router();
const serve = (load) =>
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ data: await load() });
  });

router.get('/stats', serve(getStats));
router.get('/featured', serve(getFeatured));
router.get('/trending', serve(getTrending));
router.get('/activity', serve(getActivity));
router.get('/spotlight', serve(getSpotlight));
router.get('/categories', serve(getCategories));

export default router;
