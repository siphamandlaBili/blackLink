import { Business, Review, ReviewVote, User } from '../models/index.js';
import { invalidate } from '../utils/cache.js';
import { AppError, conflict, forbidden, notFound } from '../utils/errors.js';
import { fromPoint, haversineMeters } from '../utils/geo.js';
import { afterCursor, pageOf, sortObject } from '../utils/pagination.js';
import { reviewToPublic } from '../utils/reviewSerializers.js';
import { withTransaction } from '../utils/transaction.js';
import { emit } from './events.js';
import { cleanupMedia, resolveMediaList } from './mediaService.js';
import { autoModerate, textHash } from './moderation.js';
import { COUNTED, recalcAuthor, recalcBusiness } from './trustRecalc.js';

export const REVIEW_RULES = Object.freeze({ visitedWithinM: 150, perDay: 5 });
const DAY_MS = 86400000;
const AUTHOR_FIELDS = { displayName: 1, avatarUrl: 1, badges: 1, reviewCount: 1, helpfulVotesReceived: 1 };
const SORTS = {
  helpful: [['helpfulCount', -1], ['createdAt', -1], ['_id', -1]],
  newest: [['createdAt', -1], ['_id', -1]],
  highest: [['rating', -1], ['createdAt', -1], ['_id', -1]],
  lowest: [['rating', 1], ['createdAt', -1], ['_id', -1]],
};

/** "Visited" is decided here, never by the client: within 150 m of the business right now. */
const isVisit = (location, business) => Boolean(location && business?.location) && haversineMeters(location, fromPoint(business.location)) <= REVIEW_RULES.visitedWithinM;

async function withAuthors(rows, user) {
  const authorIds = rows.map((r) => r.authorId).filter(Boolean);
  const [authors, votes] = await Promise.all([
    User.find({ _id: { $in: authorIds } }, AUTHOR_FIELDS).lean(),
    user ? ReviewVote.find({ userId: user._id, reviewId: { $in: rows.map((r) => r._id) } }, { reviewId: 1 }).lean() : [],
  ]);
  const byId = new Map(authors.map((a) => [String(a._id), a]));
  const voted = new Set(votes.map((v) => String(v.reviewId)));
  return rows.map((r) =>
    reviewToPublic(r, r.authorId ? byId.get(String(r.authorId)) : null, user ? { helpful: voted.has(String(r._id)), mine: String(r.authorId) === String(user._id) } : undefined),
  );
}

/** GET /businesses/:id/reviews — public list with filters, sorts and cursor pages. */
export async function listReviews(businessId, query, user) {
  if (!(await Business.exists({ _id: businessId, status: 'published' }))) throw notFound('Business not found');
  const filter = { businessId, status: COUNTED };
  if (query.stars?.length) filter.rating = { $in: query.stars };
  if (query.withPhotos) filter['photos.0'] = { $exists: true };
  if (query.visited) filter.visited = true;
  const sort = SORTS[query.sort];
  const rows = await Review.find({ ...filter, ...afterCursor(query.cursor, sort) })
    .sort(sortObject(sort))
    .limit(query.limit + 1)
    .lean();
  const { items, nextCursor } = pageOf(rows, query.limit, sort);
  const mine = user && !query.cursor ? await Review.findOne({ businessId, authorId: user._id, status: COUNTED }, { _id: 1 }).lean() : null;
  return { items: await withAuthors(items, user), nextCursor, myReviewId: mine ? String(mine._id) : null };
}

/** GET /me/reviews — the signed-in user's own reviews, newest first, with the business name. */
export async function listMyReviews(user, query) {
  const sort = SORTS.newest;
  const rows = await Review.find({ authorId: user._id, status: COUNTED, ...afterCursor(query.cursor, sort) }).sort(sortObject(sort)).limit(query.limit + 1).lean();
  const { items, nextCursor } = pageOf(rows, query.limit, sort);
  const businesses = await Business.find({ _id: { $in: items.map((r) => r.businessId) } }, { name: 1, slug: 1 }).lean();
  const byId = new Map(businesses.map((b) => [String(b._id), b]));
  const shaped = await withAuthors(items, user);
  return { items: shaped.map((r) => ({ ...r, business: byId.has(r.businessId) ? { name: byId.get(r.businessId).name, slug: byId.get(r.businessId).slug } : null })), nextCursor };
}

/**
 * POST /businesses/:id/reviews. Rules: verified email (route), one review per business
 * (409), not your own business (403), at most 5 per rolling 24 hours (429).
 * The review, its moderation, the business's stats and Trust Score, and the author's
 * counts and badges are all written in one transaction.
 */
export async function createReview(businessId, user, input) {
  const business = await Business.findOne({ _id: businessId, status: 'published' }, { ownerId: 1, location: 1, name: 1, slug: 1 }).lean();
  if (!business) throw notFound('Business not found');
  if (String(business.ownerId) === String(user._id)) throw forbidden("You can't review your own business");
  const existing = await Review.findOne({ businessId, authorId: user._id }, { _id: 1 }).lean();
  if (existing) throw conflict('You have already reviewed this business. Edit your review instead.', { reviewId: String(existing._id) });
  const today = await Review.countDocuments({ authorId: user._id, createdAt: { $gte: new Date(Date.now() - DAY_MS) } });
  if (today >= REVIEW_RULES.perDay) throw new AppError(429, 'REVIEW_LIMIT', `You can post up to ${REVIEW_RULES.perDay} reviews a day`);

  const { location, photos, ...fields } = input; // location is used for the Visited check only, never stored
  const visited = isVisit(location, business);
  if (photos) fields.photos = (await resolveMediaList(photos, [], String(user._id))).media;
  let saved;
  try {
    saved = await withTransaction(async (session) => {
      const [review] = await Review.create([{ ...fields, businessId, authorId: user._id, visited, textHash: textHash(fields.text) }], { session });
      await autoModerate(review, session);
      await recalcBusiness(businessId, session);
      await recalcAuthor(user._id, session);
      return Review.findById(review._id).session(session).lean();
    });
  } catch (err) {
    if (err?.code === 11000) throw conflict('You have already reviewed this business. Edit your review instead.');
    throw err;
  }
  invalidate('public:');
  emit('review.created', { review: saved, business });
  const author = await User.findById(user._id, AUTHOR_FIELDS).lean();
  return reviewToPublic(saved, author, { helpful: false, mine: true });
}

async function ownReview(reviewId, user) {
  const review = await Review.findById(reviewId).lean();
  if (!review || review.status === 'removed') throw notFound('Review not found');
  if (String(review.authorId) !== String(user._id)) throw forbidden('Only the author can change this review');
  return review;
}

/** PATCH /reviews/:id — author only. Marked "edited"; Visited can be earned, never lost. */
export async function updateReview(reviewId, user, input) {
  const review = await ownReview(reviewId, user);
  const { location, photos, ...fields } = input;
  const business = await Business.findById(review.businessId, { location: 1 }).lean();
  let removedPhotos = [];
  if (photos) {
    const r = await resolveMediaList(photos, review.photos, String(user._id));
    fields.photos = r.media;
    removedPhotos = r.removed;
  }
  const $set = { ...fields, edited: true };
  if (fields.text !== undefined) $set.textHash = textHash(fields.text);
  if (!review.visited && isVisit(location, business)) $set.visited = true;

  const saved = await withTransaction(async (session) => {
    await Review.updateOne({ _id: reviewId }, { $set }, { session });
    if (fields.text !== undefined) await autoModerate({ ...review, textHash: $set.textHash }, session, { only: 'duplicate' });
    await recalcBusiness(review.businessId, session);
    await recalcAuthor(user._id, session);
    return Review.findById(reviewId).session(session).lean();
  });
  cleanupMedia(removedPhotos);
  invalidate('public:');
  const author = await User.findById(user._id, AUTHOR_FIELDS).lean();
  return reviewToPublic(saved, author, { helpful: false, mine: true });
}

/** DELETE /reviews/:id — author only. Removes the review and its helpful votes, then recalculates. */
export async function deleteReview(reviewId, user) {
  const review = await ownReview(reviewId, user);
  await withTransaction(async (session) => {
    await Review.deleteOne({ _id: reviewId }, { session });
    await ReviewVote.deleteMany({ reviewId }, { session });
    if (review.helpfulCount) {
      await User.updateOne({ _id: user._id }, [{ $set: { helpfulVotesReceived: { $max: [0, { $subtract: ['$helpfulVotesReceived', review.helpfulCount] }] } } }], { session, timestamps: false });
    }
    await recalcBusiness(review.businessId, session);
    await recalcAuthor(user._id, session);
  });
  cleanupMedia((review.photos ?? []).map((p) => p.publicId));
  invalidate('public:');
  return { deleted: true };
}
