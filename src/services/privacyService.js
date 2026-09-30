import {
  Business, Comment, Event, Follow, Notification, Post, Reaction, Report, Review, ReviewVote, Rsvp, Save, User, Vouch,
} from '../models/index.js';
import { notFound } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { withTransaction } from '../utils/transaction.js';
import { deleteClerkUser } from './clerk.js';
import { destroyMedia } from './cloudinary.js';
import { recalcBusiness } from './trustRecalc.js';

/*
 * POPIA rights: access (export everything we hold about you) and deletion.
 */

const strip = ({ _id, __v, textHash, ...rest }) => ({ id: String(_id), ...rest });

/**
 * GET /me/export — everything stored about the signed-in user, as JSON. Includes their
 * own private data (email, CIPC number of their own business) but nothing private about
 * anyone else: other people appear only as ids.
 */
export async function exportMyData(userId) {
  const user = await User.findById(userId).select('+suspendedReason').lean();
  if (!user) throw notFound('Account not found');
  const q = { userId };
  const [reviews, votes, follows, saves, vouches, rsvps, posts, comments, reactions, notifications, businesses, reports] = await Promise.all([
    Review.find({ authorId: userId }).lean(),
    ReviewVote.find(q, { reviewId: 1, createdAt: 1 }).lean(),
    Follow.find(q, { businessId: 1, createdAt: 1 }).lean(),
    Save.find(q, { businessId: 1, createdAt: 1 }).lean(),
    Vouch.find(q, { businessId: 1, createdAt: 1 }).lean(),
    Rsvp.find(q, { eventId: 1, createdAt: 1 }).lean(),
    Post.find({ authorId: userId }).lean(),
    Comment.find({ authorId: userId }).lean(),
    Reaction.find(q, { postId: 1, kind: 1, createdAt: 1 }).lean(),
    Notification.find(q, { type: 1, title: 1, body: 1, readAt: 1, emailStatus: 1, createdAt: 1 }).lean(),
    Business.find({ ownerId: userId }).select('+verification.cipcNumber').lean(),
    Report.find({ reporterId: userId }, { targetType: 1, targetId: 1, reason: 1, details: 1, status: 1, createdAt: 1 }).lean(),
  ]);
  const events = await Event.find({ _id: { $in: rsvps.map((r) => r.eventId) } }, { title: 1, startsAt: 1 }).lean();
  const eventTitle = new Map(events.map((e) => [String(e._id), e.title]));
  // Everything about the account, including its internal credibility score. Only the Clerk
  // id is left out: it's an identifier at Clerk, not information about the person.
  const { clerkId, ...account } = user;
  return {
    exportedAt: new Date().toISOString(),
    about: 'Everything Black Link stores about your account. Other people appear only by id.',
    account: strip(account),
    reviews: reviews.map(strip),
    helpfulVotes: votes.map(strip),
    following: follows.map(strip),
    saved: saves.map(strip),
    vouches: vouches.map(strip),
    eventsGoing: rsvps.map((r) => ({ ...strip(r), eventTitle: eventTitle.get(String(r.eventId)) ?? null })),
    posts: posts.map(strip),
    comments: comments.map(strip),
    reactions: reactions.map(strip),
    notifications: notifications.map(strip),
    businesses: businesses.map(({ openRanges, nameLower, ...b }) => strip(b)),
    reportsFiled: reports.map(strip),
  };
}

/**
 * DELETE /me — the member deletes their account.
 *  Now (in one transaction): the account is marked deleted; their reviews become
 *  "Former member" (ratings kept, so business scores stay fair; photos removed); their
 *  listings are taken down; their saves, follows and RSVPs stop counting.
 *  After commit: the Clerk account is deleted and images are removed from Cloudinary.
 *  In 30 days: the nightly purge job removes everything that's left.
 */
export async function deleteMyAccount(user) {
  const media = [];
  const touched = await withTransaction(async (session) => {
    const reviews = await Review.find({ authorId: user._id }, { businessId: 1, photos: 1 }).session(session).lean();
    reviews.forEach((r) => media.push(...(r.photos ?? []).map((p) => p.publicId)));
    await Review.updateMany({ authorId: user._id }, { $set: { authorId: null, formerMember: true, photos: [] } }, { session, timestamps: false });

    const owned = await Business.find({ ownerId: user._id, status: { $ne: 'deleted' } }, { logo: 1, cover: 1, gallery: 1 }).session(session).lean();
    owned.forEach((b) => media.push(b.logo?.publicId, b.cover?.publicId, ...(b.gallery ?? []).map((g) => g.publicId)));
    await Business.updateMany({ ownerId: user._id, status: { $ne: 'deleted' } }, { $set: { status: 'deleted', deletedAt: new Date() } }, { session });

    const follows = await Follow.find({ userId: user._id }, { businessId: 1 }).session(session).lean();
    for (const f of follows) await Business.updateOne({ _id: f.businessId, 'stats.followerCount': { $gt: 0 } }, { $inc: { 'stats.followerCount': -1 } }, { session, timestamps: false });
    const rsvps = await Rsvp.find({ userId: user._id }, { eventId: 1 }).session(session).lean();
    for (const r of rsvps) await Event.updateOne({ _id: r.eventId, rsvpCount: { $gt: 0 } }, { $inc: { rsvpCount: -1 } }, { session, timestamps: false });
    await Promise.all([Follow.deleteMany({ userId: user._id }, { session }), Save.deleteMany({ userId: user._id }, { session }), Rsvp.deleteMany({ userId: user._id }, { session })]);

    await User.updateOne({ _id: user._id }, { $set: { status: 'deleted', deletedAt: new Date() } }, { session });
    const ids = new Set(reviews.map((r) => String(r.businessId)));
    for (const id of ids) await recalcBusiness(id, session);
    return ids.size;
  });

  destroyMedia(media);
  if (user.clerkId) {
    try {
      await deleteClerkUser(user.clerkId);
    } catch (err) {
      // The account is already unusable (status "deleted"); Clerk can be cleaned up later.
      logger.error({ reason: err?.message }, 'Clerk user deletion failed');
    }
  }
  return { deleted: true, permanentRemovalInDays: 30, reviewsAnonymised: true, businessesRecalculated: touched };
}
