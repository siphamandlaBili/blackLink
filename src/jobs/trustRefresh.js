import { Business } from '../models/index.js';
import { invalidate } from '../utils/cache.js';
import { recalcBusiness } from '../services/trustRecalc.js';

/** SAST calendar day, e.g. "2026-09-30": the key for nightly jobs. */
export const sastDay = (now) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(now);

/**
 * Nightly. Trust Scores include a recency signal (reviews from the last 6 months weigh
 * more), which changes as time passes even without new reviews, so every published
 * business is recalculated. Each recalculation is independent; a crash mid-way is fixed
 * by the next run.
 */
export const trustRefresh = {
  name: 'trust-refresh',
  key: sastDay,
  async run(now) {
    let count = 0;
    let lastId = null;
    for (;;) {
      const batch = await Business.find({ status: 'published', ...(lastId ? { _id: { $gt: lastId } } : {}) }, { _id: 1 }).sort({ _id: 1 }).limit(100).lean();
      if (!batch.length) break;
      for (const b of batch) {
        await recalcBusiness(b._id, undefined, now.getTime());
        count += 1;
      }
      lastId = batch[batch.length - 1]._id;
    }
    invalidate('public:');
    return { recalculated: count };
  },
};
