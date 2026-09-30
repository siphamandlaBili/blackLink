import mongoose from 'mongoose';
import { Business, Offer, User, Vouch } from '../models/index.js';
import { businessToOwner, businessToProfile } from '../utils/businessSerializers.js';
import { invalidate } from '../utils/cache.js';
import { AppError, forbidden, notFound } from '../utils/errors.js';
import { insideSoweto, toPoint } from '../utils/geo.js';
import { isSaMobile } from '../utils/phone.js';
import { uniqueSlug } from '../utils/slug.js';
import { viewerFlags } from './businessQuery.js';
import { emit } from './events.js';
import { cleanupMedia, resolveMediaList, resolveMediaOne } from './mediaService.js';
import { weeklyRanges } from './openNow.js';

const MAX_BUSINESSES_PER_OWNER = 10;

const canEdit = (business, user) => user && (user.role === 'admin' || String(business.ownerId) === String(user._id));

/** Loads a business the user may edit, or throws. The ownership check lives here, not in the route. */
async function editable(id, user) {
  const business = await Business.findOne({ _id: id, status: { $ne: 'deleted' } }).select('+verification.cipcNumber');
  if (!business) throw notFound('Business not found');
  if (!canEdit(business, user)) throw forbidden('Only the owner can change this business');
  return business;
}

async function activeOffers(businessId, now = new Date()) {
  return Offer.find(
    { businessId, status: 'active', startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gt: now } }] },
    { title: 1, description: 1, priceCents: 1, endsAt: 1 },
  )
    .sort({ endsAt: 1 })
    .lean();
}

/**
 * GET /businesses/:slug. Published listings for everyone; drafts and suspended listings
 * only for their owner (or an admin), who also get the owner view.
 */
export async function getProfile(slug, user) {
  const b = await Business.findOne({ slug, status: { $ne: 'deleted' } }).select('+verification.cipcNumber').lean();
  if (!b) throw notFound('Business not found');
  const owner = canEdit(b, user);
  if (b.status !== 'published' && !owner) throw notFound('Business not found');
  const [offers, flags, vouched] = await Promise.all([
    activeOffers(b._id),
    viewerFlags(user, [b._id]),
    user ? Vouch.exists({ businessId: b._id, userId: user._id }) : null,
  ]);
  const viewer = user ? { ...flags(b._id), vouched: Boolean(vouched), isOwner: owner } : undefined;
  return owner ? businessToOwner(b, { offers, viewer }) : businessToProfile(b, { offers, viewer });
}

/** Owner's own listings (drafts included), newest first. */
export async function listMine(user) {
  const rows = await Business.find({ ownerId: user._id, status: { $ne: 'deleted' } }).select('+verification.cipcNumber').sort({ updatedAt: -1 }).lean();
  return rows.map((b) => businessToOwner(b));
}

/**
 * Verifies any newly uploaded logo, cover or gallery images (they must be the editor's own
 * uploads) and returns the input with media objects, plus the old images to delete.
 */
async function withMedia(business, input, user) {
  const out = { ...input };
  const removed = [];
  for (const slot of ['logo', 'cover']) {
    if (input[slot] === undefined) continue;
    const r = await resolveMediaOne(input[slot], business[slot], String(user._id));
    out[slot] = r.media;
    removed.push(...r.removed);
  }
  if (input.gallery !== undefined) {
    const r = await resolveMediaList(input.gallery, business.gallery, String(user._id));
    out.gallery = r.media;
    removed.push(...r.removed);
  }
  return { input: out, removed };
}

/** Maps validated wizard input onto the document (server-owned fields are never in `input`). */
function applyInput(business, input) {
  const { location, cipcNumber, hours, ...rest } = input;
  business.set(rest);
  if (location) {
    if (!insideSoweto(location)) throw new AppError(422, 'OUTSIDE_SOWETO', 'Drop the pin inside Soweto');
    business.location = toPoint(location.lat, location.lng);
  }
  if (hours) {
    business.hours = { ...business.hours?.toObject?.(), ...hours };
    business.openRanges = weeklyRanges(business.hours.toObject());
  }
  if (cipcNumber !== undefined) {
    business.verification.cipcNumber = cipcNumber;
    // A typed number isn't proof; it's checked before the "registered" tier is granted.
    business.verification.cipcStatus = cipcNumber ? 'pending' : 'none';
  }
}

/**
 * POST /businesses — starts a draft. Creating a business makes a customer an owner.
 * Runs in a transaction so the role change and the draft land together.
 */
export async function createDraft(user, input) {
  const count = await Business.countDocuments({ ownerId: user._id, status: { $ne: 'deleted' } });
  if (count >= MAX_BUSINESSES_PER_OWNER) throw new AppError(422, 'LIMIT_REACHED', `You can list up to ${MAX_BUSINESSES_PER_OWNER} businesses`);

  const { input: prepared } = await withMedia({}, input, user);
  const session = await mongoose.startSession();
  try {
    let created;
    await session.withTransaction(async () => {
      const _id = new mongoose.Types.ObjectId();
      const business = new Business({ _id, ownerId: user._id, slug: `draft-${_id}`, status: 'draft' });
      applyInput(business, prepared);
      await business.save({ session });
      if (user.role === 'customer') await User.updateOne({ _id: user._id }, { $set: { role: 'owner' } }, { session });
      created = business;
    });
    return businessToOwner(created.toObject());
  } finally {
    await session.endSession();
  }
}

/** PATCH /businesses/:id — saves a wizard step, or edits a live listing. */
export async function updateBusiness(id, user, input) {
  const business = await editable(id, user);
  const { input: prepared, removed } = await withMedia(business, input, user);
  applyInput(business, prepared);
  if (input.onboardingStep !== undefined) business.onboardingStep = Math.max(business.onboardingStep, input.onboardingStep);
  await business.save();
  cleanupMedia(removed);
  if (business.status === 'published') invalidate('public:');
  const offers = await activeOffers(business._id);
  return businessToOwner(business.toObject(), { offers });
}

/** Required before a listing goes live. Returns the missing field names. */
function missingForPublish(b) {
  const missing = [];
  if (!b.name || b.name.trim().length < 2) missing.push('name');
  if (!b.category) missing.push('category');
  if (!b.location?.coordinates?.length) missing.push('location');
  if (!b.township) missing.push('township');
  if (!b.whatsapp || !isSaMobile(b.whatsapp)) missing.push('whatsapp');
  if (!weeklyRanges(b.hours?.toObject?.() ?? b.hours).length) missing.push('hours');
  return missing;
}

/** POST /businesses/:id/publish — validates, gives the listing its real slug, goes live. */
export async function publishBusiness(id, user) {
  const business = await editable(id, user);
  if (business.status === 'suspended') throw forbidden('This listing is suspended');
  const missing = missingForPublish(business);
  if (missing.length) throw new AppError(422, 'INCOMPLETE_LISTING', 'Some required details are missing', { missing });

  const firstPublish = business.status !== 'published';
  if (firstPublish) {
    business.slug = await uniqueSlug(business.name, (s) => Business.exists({ slug: s, _id: { $ne: business._id } }));
    business.status = 'published';
    business.publishedAt = new Date();
    business.onboardingStep = 8;
  }
  await business.save();
  invalidate('public:');
  if (firstPublish) emit('business.published', { business: business.toObject() });
  return businessToOwner(business.toObject(), { offers: await activeOffers(business._id) });
}

/**
 * DELETE /businesses/:id — an owner throws away an unfinished draft ("Start over").
 * Published listings can't be deleted this way; they are taken down by deleting the account
 * or by an admin, so reviews and history stay consistent.
 */
export async function deleteDraft(id, user) {
  const business = await editable(id, user);
  if (business.status !== 'draft') throw new AppError(409, 'NOT_A_DRAFT', 'Only unfinished drafts can be deleted');
  const media = [business.logo?.publicId, business.cover?.publicId, ...(business.gallery ?? []).map((g) => g.publicId)].filter(Boolean);
  await Business.deleteOne({ _id: business._id, status: 'draft' });
  cleanupMedia(media);
  return { deleted: true };
}
