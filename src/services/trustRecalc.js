import { Business, Review, User } from '../models/index.js';
import { cached } from '../utils/cache.js';
import { computeReviewStats } from './reviewStats.js';
import { computeTrustScore, reviewerCredibility } from './trustScore.js';

/*
 * Keeps server-owned aggregates in step with reviews. Called inside the same transaction
 * as the review change, so a business's stats and Trust Score can never disagree with
 * its reviews. Both functions recompute from scratch (no ±1 bookkeeping to drift).
 */

// Reviews that count: published, plus flagged ones (they stay visible until a moderator decides).
export const COUNTED = { $in: ['published', 'flagged'] };
export const TOP_REVIEWER_AT = 20;

/** Platform-wide mean rating (m in the Bayesian average). Stable enough to cache for 10 minutes. */
export const platformMean = () =>
  cached('trust:platformMean', 10 * 60 * 1000, async () => {
    const [row] = await Review.aggregate([{ $match: { status: COUNTED } }, { $group: { _id: null, m: { $avg: '$rating' } } }]);
    return row?.m ?? 4;
  });

/**
 * Recomputes one business's review stats and Trust Score.
 * @param {import('mongoose').Types.ObjectId|string} businessId
 * @param {import('mongoose').ClientSession} [session]
 */
export async function recalcBusiness(businessId, session, now = Date.now()) {
  const business = await Business.findById(businessId, { verification: 1 }).session(session ?? null).lean();
  if (!business) return null;
  const reviews = await Review.find(
    { businessId, status: COUNTED },
    { rating: 1, subRatings: 1, visited: 1, createdAt: 1, ownerReply: 1, authorId: 1 },
  )
    .session(session ?? null)
    .lean();
  const authorIds = [...new Set(reviews.map((r) => r.authorId).filter(Boolean).map(String))];
  const authors = await User.find({ _id: { $in: authorIds } }, { emailVerified: 1, createdAt: 1, helpfulVotesReceived: 1 })
    .session(session ?? null)
    .lean();
  const byId = new Map(authors.map((a) => [String(a._id), a]));

  const stats = computeReviewStats(reviews);
  const trust = computeTrustScore({
    reviews,
    verificationLevel: business.verification?.level ?? 'phone',
    platformMean: await platformMean(),
    getAuthor: (id) => (id ? byId.get(String(id)) ?? null : null),
    now,
  });
  await Business.updateOne(
    { _id: businessId },
    {
      $set: {
        'stats.rating': stats.rating,
        'stats.reviewCount': stats.reviewCount,
        'stats.distribution': stats.distribution,
        'stats.subRatings': stats.subRatings,
        'stats.responseRate': trust.responseRate,
        'stats.avgReplyHours': trust.avgReplyHours,
        trust: { score: trust.score, tier: trust.tier, breakdown: trust.breakdown, calculatedAt: new Date(now) },
      },
    },
    { session, timestamps: false },
  );
  return { stats, trust };
}

/**
 * Recomputes a reviewer's review count, credibility and badges. Badges are earned for good:
 * "first-review" at one review, "top-reviewer" at 20.
 * @param {import('mongoose').Types.ObjectId|string} userId
 * @param {import('mongoose').ClientSession} [session]
 */
export async function recalcAuthor(userId, session, now = Date.now()) {
  if (!userId) return null;
  const user = await User.findById(userId, { emailVerified: 1, createdAt: 1, helpfulVotesReceived: 1 }).session(session ?? null).lean();
  if (!user) return null;
  const reviews = await Review.find({ authorId: userId, status: COUNTED }, { visited: 1 }).session(session ?? null).lean();
  const credibility = reviews.length
    ? reviews.reduce((acc, r) => acc + reviewerCredibility(r, user, now), 0) / reviews.length
    : reviewerCredibility({ visited: false }, user, now);
  const badges = [];
  if (reviews.length >= 1) badges.push('first-review');
  if (reviews.length >= TOP_REVIEWER_AT) badges.push('top-reviewer');
  await User.updateOne(
    { _id: userId },
    {
      $set: { reviewCount: reviews.length, credibility: Math.round(credibility * 100) / 100 },
      ...(badges.length ? { $addToSet: { badges: { $each: badges } } } : {}),
    },
    { session, timestamps: false },
  );
  return { reviewCount: reviews.length, credibility };
}
