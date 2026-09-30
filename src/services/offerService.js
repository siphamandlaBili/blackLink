import { Business, Offer } from '../models/index.js';
import { invalidate } from '../utils/cache.js';
import { offerToPublic } from '../utils/communitySerializers.js';
import { AppError, forbidden, notFound } from '../utils/errors.js';

export const MAX_LIVE_OFFERS = 5;

/** Offers live right now: active, started, not yet ended. */
const liveFilter = (now = new Date()) => ({ status: 'active', startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] });

/**
 * Keeps Business.hasActiveOffer true exactly when a live offer exists. Called after every
 * offer change, and by the hourly offer-expiry job (Phase 6) for offers that start or end
 * on their own.
 */
export async function syncHasActiveOffer(businessId, now = new Date()) {
  const has = Boolean(await Offer.exists({ businessId, ...liveFilter(now) }));
  const res = await Business.updateOne({ _id: businessId, hasActiveOffer: { $ne: has } }, { $set: { hasActiveOffer: has } }, { timestamps: false });
  if (res.modifiedCount) invalidate('public:');
  return has;
}

async function ownedBusiness(businessId, user) {
  const b = await Business.findOne({ _id: businessId, status: { $ne: 'deleted' } }, { ownerId: 1 }).lean();
  if (!b) throw notFound('Business not found');
  if (user.role !== 'admin' && String(b.ownerId) !== String(user._id)) throw forbidden('Only the owner can manage offers');
  return b;
}

/** Public: live offers. Owner with ?all=true: everything except removed, including scheduled and expired. */
export async function listOffers(businessId, user, { all } = {}) {
  let filter = liveFilter();
  if (all) {
    if (!user) throw forbidden('Only the owner can see all offers');
    await ownedBusiness(businessId, user);
    filter = { status: { $ne: 'removed' } };
  }
  const rows = await Offer.find({ businessId, ...filter }).sort({ startsAt: -1 }).limit(50).lean();
  return rows.map((o) => offerToPublic(o));
}

export async function createOffer(businessId, user, input) {
  await ownedBusiness(businessId, user);
  const now = new Date();
  const upcoming = await Offer.countDocuments({ businessId, status: 'active', $or: [{ endsAt: null }, { endsAt: { $gt: now } }] });
  if (upcoming >= MAX_LIVE_OFFERS) throw new AppError(422, 'OFFER_LIMIT', `You can run up to ${MAX_LIVE_OFFERS} offers at a time`);
  const offer = await Offer.create({ ...input, businessId, startsAt: input.startsAt ?? now });
  await syncHasActiveOffer(businessId);
  return offerToPublic(offer.toObject());
}

async function ownedOffer(offerId, user) {
  const offer = await Offer.findOne({ _id: offerId, status: { $ne: 'removed' } }).lean();
  if (!offer) throw notFound('Offer not found');
  await ownedBusiness(offer.businessId, user);
  return offer;
}

export async function updateOffer(offerId, user, input) {
  const offer = await ownedOffer(offerId, user);
  const startsAt = input.startsAt ?? offer.startsAt;
  const endsAt = input.endsAt === undefined ? offer.endsAt : input.endsAt;
  if (endsAt && endsAt <= startsAt) throw new AppError(422, 'OFFER_TIMES', 'The end must be after the start');
  const $set = { ...input };
  // Editing an expired offer's end date into the future brings it back.
  if (offer.status === 'expired' && (!endsAt || endsAt > new Date())) $set.status = 'active';
  const saved = await Offer.findByIdAndUpdate(offerId, { $set }, { new: true }).lean();
  await syncHasActiveOffer(offer.businessId);
  return offerToPublic(saved);
}

export async function removeOffer(offerId, user) {
  const offer = await ownedOffer(offerId, user);
  await Offer.updateOne({ _id: offerId }, { $set: { status: 'removed' } });
  await syncHasActiveOffer(offer.businessId);
  return { removed: true };
}
