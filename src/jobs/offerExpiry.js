import { Business, Offer } from '../models/index.js';
import { syncHasActiveOffer } from '../services/offerService.js';

/**
 * Hourly. Marks ended offers "expired" and re-syncs Business.hasActiveOffer for every
 * business whose offers started or ended recently, or that still shows an offer. Safe to
 * run any number of times: it only moves data toward the truth for `now`.
 */
export const offerExpiry = {
  name: 'offer-expiry',
  key: (now) => now.toISOString().slice(0, 13), // one run per UTC hour
  async run(now) {
    const since = new Date(now.getTime() - 3 * 3600000); // overlap covers a skipped hour
    const expired = await Offer.updateMany({ status: 'active', endsAt: { $ne: null, $lte: now } }, { $set: { status: 'expired' } });
    const touched = await Offer.distinct('businessId', { $or: [{ endsAt: { $gte: since, $lte: now } }, { startsAt: { $gte: since, $lte: now } }] });
    const showing = await Business.distinct('_id', { hasActiveOffer: true });
    const ids = [...new Set([...touched, ...showing].map(String))];
    let changed = 0;
    for (const id of ids) {
      const before = showing.some((s) => String(s) === id);
      if ((await syncHasActiveOffer(id, now)) !== before) changed += 1;
    }
    return { expired: expired.modifiedCount, checked: ids.length, changed };
  },
};
