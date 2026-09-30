import mongoose from 'mongoose';
import { Business, Event, Follow, Rsvp, Vouch } from '../models/index.js';
import { businessToCard } from '../utils/businessSerializers.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { CARD_FIELDS } from './businessQuery.js';

export const VOUCHES_FOR_UPGRADE = 3;

async function publishedBusiness(id, session) {
  const b = await Business.findOne({ _id: id, status: 'published' }, { ownerId: 1, verification: 1 }).session(session ?? null).lean();
  if (!b) throw notFound('Business not found');
  return b;
}

/**
 * Adds or removes a (user, business) pair and moves the matching counter by ±1, in one
 * transaction. The unique index on the pair makes repeats harmless: following twice is a
 * no-op, not a double count.
 * @returns {Promise<{ active: boolean, count: number }>}
 */
async function toggle({ Model, counter, businessId, userId, on }) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      await publishedBusiness(businessId, session);
      let changed = false;
      if (on) {
        const res = await Model.updateOne({ userId, businessId }, { $setOnInsert: { userId, businessId } }, { upsert: true, session });
        changed = res.upsertedCount === 1;
      } else {
        const res = await Model.deleteOne({ userId, businessId }, { session });
        changed = res.deletedCount === 1;
      }
      const inc = changed ? (on ? 1 : -1) : 0;
      const updated = await Business.findOneAndUpdate(
        { _id: businessId },
        inc ? { $inc: { [`stats.${counter}`]: inc } } : {},
        { new: true, session, projection: { [`stats.${counter}`]: 1 }, timestamps: false },
      ).lean();
      result = { active: on, count: Math.max(0, updated.stats?.[counter] ?? 0) };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export const follow = (businessId, user) => toggle({ Model: Follow, counter: 'followerCount', businessId, userId: user._id, on: true });
export const unfollow = (businessId, user) => toggle({ Model: Follow, counter: 'followerCount', businessId, userId: user._id, on: false });

/**
 * POST /businesses/:id/vouch — a member vouches for a business they know. At three
 * vouches a phone-verified business becomes "vouched" (never downgrades "registered").
 * Owners can't vouch for their own business; each member vouches once.
 */
export async function vouch(businessId, user) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const b = await publishedBusiness(businessId, session);
      if (String(b.ownerId) === String(user._id)) throw forbidden("You can't vouch for your own business");
      try {
        await Vouch.create([{ userId: user._id, businessId }], { session });
      } catch (err) {
        if (err?.code === 11000) throw conflict('You have already vouched for this business');
        throw err;
      }
      const updated = await Business.findOneAndUpdate(
        { _id: businessId },
        { $inc: { 'verification.vouchCount': 1 } },
        { new: true, session, projection: { verification: 1 }, timestamps: false },
      ).lean();
      let level = updated.verification.level;
      if (level === 'phone' && updated.verification.vouchCount >= VOUCHES_FOR_UPGRADE) {
        await Business.updateOne({ _id: businessId }, { $set: { 'verification.level': 'vouched' } }, { session });
        level = 'vouched';
      }
      result = { vouchCount: updated.verification.vouchCount, verificationLevel: level, upgraded: level !== b.verification.level };
    });
    return result;
  } finally {
    await session.endSession();
  }
}

// Enough for any real member; the lists only drive saved/following/going toggles in the app.
const ENGAGEMENT_CAP = 1000;

/**
 * Ids the user follows and events they're going to, so the app can show toggles in the right
 * state everywhere. Only published businesses and upcoming, scheduled events are listed.
 */
export async function myEngagement(userId) {
  const [follows, rsvps] = await Promise.all([
    Follow.find({ userId }, { businessId: 1 }).sort({ createdAt: -1 }).limit(ENGAGEMENT_CAP).lean(),
    Rsvp.find({ userId }, { eventId: 1 }).sort({ createdAt: -1 }).limit(ENGAGEMENT_CAP).lean(),
  ]);
  const businessIds = follows.map((x) => x.businessId);
  const [live, events] = await Promise.all([
    Business.find({ _id: { $in: businessIds }, status: 'published' }, { _id: 1 }).lean(),
    Event.find({ _id: { $in: rsvps.map((r) => r.eventId) }, status: 'scheduled', endsAt: { $gt: new Date() } }, { _id: 1 }).lean(),
  ]);
  const ok = new Set(live.map((b) => String(b._id)));
  const pick = (rows) => rows.map((x) => String(x.businessId)).filter((id) => ok.has(id));
  return { following: pick(follows), going: events.map((e) => String(e._id)) };
}

/**
 * GET /me/businesses?list=following — the cards behind the profile's Following list, most
 * recently followed first. Listings that were taken down drop out.
 */
export async function myBusinessCards(user) {
  const rows = await Follow.find({ userId: user._id }, { businessId: 1 }).sort({ createdAt: -1 }).limit(200).lean();
  const order = rows.map((r) => String(r.businessId));
  const businesses = await Business.find({ _id: { $in: rows.map((r) => r.businessId) }, status: 'published' }, CARD_FIELDS).lean();
  businesses.sort((a, b) => order.indexOf(String(a._id)) - order.indexOf(String(b._id)));
  const now = new Date();
  return businesses.map((b) => businessToCard(b, { now, viewer: { following: true } }));
}
