import { Business, Report, Review, ReviewVote, User } from '../models/index.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { withTransaction } from '../utils/transaction.js';
import { emit } from './events.js';
import { COUNTED, recalcBusiness } from './trustRecalc.js';

async function visibleReview(reviewId, session) {
  const review = await Review.findOne({ _id: reviewId, status: COUNTED }).session(session ?? null).lean();
  if (!review) throw notFound('Review not found');
  return review;
}

/**
 * POST/DELETE /reviews/:id/helpful. One vote per member per review (unique index), never on
 * your own review. The review's helpfulCount, the author's helpfulVotesReceived and the
 * business's Trust Score (reviewer credibility) move together in one transaction.
 */
export async function setHelpful(reviewId, user, on) {
  const review = await visibleReview(reviewId);
  if (String(review.authorId) === String(user._id)) throw forbidden("You can't mark your own review as helpful");
  return withTransaction(async (session) => {
    let changed;
    if (on) {
      const res = await ReviewVote.updateOne({ reviewId, userId: user._id }, { $setOnInsert: { reviewId, userId: user._id } }, { upsert: true, session });
      changed = res.upsertedCount === 1;
    } else {
      changed = (await ReviewVote.deleteOne({ reviewId, userId: user._id }, { session })).deletedCount === 1;
    }
    if (changed) {
      const inc = on ? 1 : -1;
      await Review.updateOne({ _id: reviewId }, { $inc: { helpfulCount: inc } }, { session, timestamps: false });
      if (review.authorId) await User.updateOne({ _id: review.authorId }, { $inc: { helpfulVotesReceived: inc } }, { session, timestamps: false });
      await recalcBusiness(review.businessId, session);
    }
    const fresh = await Review.findById(reviewId, { helpfulCount: 1 }).session(session).lean();
    return { helpful: on, helpfulCount: Math.max(0, fresh.helpfulCount) };
  });
}

/**
 * PUT /reviews/:id/reply — the owner of the reviewed business only (not even admins: the
 * reply speaks for the business). One public reply per review, editable. Replies feed the
 * Trust Score's responsiveness signal, so the business is recalculated.
 */
export async function replyToReview(reviewId, user, text) {
  const review = await visibleReview(reviewId);
  const business = await Business.findById(review.businessId, { ownerId: 1, name: 1, slug: 1 }).lean();
  if (!business || String(business.ownerId) !== String(user._id)) throw forbidden('Only the owner of this business can reply');
  const now = new Date();
  const reply = { text, createdAt: review.ownerReply?.createdAt ?? now, updatedAt: now };
  await withTransaction(async (session) => {
    await Review.updateOne({ _id: reviewId }, { $set: { ownerReply: reply } }, { session, timestamps: false });
    await recalcBusiness(review.businessId, session);
  });
  if (!review.ownerReply) emit('review.replied', { review: { ...review, ownerReply: reply }, business });
  return { reviewId: String(reviewId), ownerReply: reply };
}

/**
 * POST /reviews/:id/report. Any member, including the business owner (owners can't delete
 * reviews, only report them). Once per member per review. Goes to the moderation queue.
 */
export async function reportReview(reviewId, user, { reason, details = '' }) {
  const review = await visibleReview(reviewId);
  if (String(review.authorId) === String(user._id)) throw forbidden("You can't report your own review");
  try {
    const report = await Report.create({ targetType: 'review', targetId: reviewId, reporterId: user._id, reason, details });
    return { id: String(report._id), status: report.status };
  } catch (err) {
    if (err?.code === 11000) throw conflict('You have already reported this review');
    throw err;
  }
}
