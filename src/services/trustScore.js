/**
 * Trust Score (0–100). A pure function: give it a business's published reviews and
 * verification level, get back the score, tier and a per-signal breakdown. No database
 * access here, so it is easy to test and to run in bulk (seed, nightly refresh).
 *
 * Everything tunable lives in TRUST_CONFIG.
 */
export const TRUST_CONFIG = Object.freeze({
  weights: Object.freeze({
    ratingQuality: 0.4,
    reviewVolume: 0.15,
    reviewerCredibility: 0.15,
    recency: 0.1,
    responsiveness: 0.1,
    verification: 0.1,
  }),
  // Bayesian prior strength C: every business starts as if it had C platform-average reviews.
  bayesianPrior: 5,
  // Rating quality = ((bayes − 1) / 4) ^ ratingCurve. Above 1, weak averages lose more marks.
  ratingCurve: 1.5,
  fullVolumeAt: 50,
  recentDays: 183,
  fastReplyHours: 24,
  slowReplyHours: 14 * 24,
  replyRateShare: 0.7,
  verification: Object.freeze({ phone: 1 / 3, vouched: 2 / 3, registered: 1 }),
  // Fewer reviews than this → "building" tier regardless of score.
  minReviewsForScore: 5,
  // Lowest score for each tier, highest first.
  tiers: Object.freeze([
    { id: 'high', min: 85 },
    { id: 'trusted', min: 70 },
    { id: 'good', min: 50 },
    { id: 'fair', min: 0 },
  ]),
  // Reviewer credibility parts (sum to 1).
  credibility: Object.freeze({ emailVerified: 0.4, accountAge: 0.2, helpfulVotes: 0.2, visited: 0.2, fullAgeDays: 365, fullHelpful: 20 }),
});

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/**
 * Credibility of one review, 0–1: the author's verified email, account age and helpful
 * votes received, plus whether this review was a verified in-person visit.
 * @param {{ visited?: boolean }} review
 * @param {{ emailVerified?: boolean, createdAt?: Date|string, helpfulVotesReceived?: number }|null} author
 * @param {number} now
 */
export function reviewerCredibility(review, author, now = Date.now()) {
  const c = TRUST_CONFIG.credibility;
  if (!author) return 0.3; // former members: neutral-low, so anonymised reviews still count a little
  const ageDays = author.createdAt ? (now - new Date(author.createdAt).getTime()) / DAY_MS : 0;
  return (
    (author.emailVerified ? c.emailVerified : 0) +
    c.accountAge * clamp01(ageDays / c.fullAgeDays) +
    c.helpfulVotes * clamp01((author.helpfulVotesReceived ?? 0) / c.fullHelpful) +
    (review.visited ? c.visited : 0)
  );
}

function responsiveness(reviews) {
  const replied = reviews.filter((r) => r.ownerReply?.createdAt);
  const replyRate = reviews.length ? replied.length / reviews.length : 0;
  if (!replied.length) return { replyRate, avgReplyHours: null, value: TRUST_CONFIG.replyRateShare * replyRate };
  const avgReplyHours =
    replied.reduce((acc, r) => acc + (new Date(r.ownerReply.createdAt) - new Date(r.createdAt)) / HOUR_MS, 0) / replied.length;
  const { fastReplyHours: fast, slowReplyHours: slow, replyRateShare: share } = TRUST_CONFIG;
  const speed = clamp01(1 - (avgReplyHours - fast) / (slow - fast));
  return { replyRate, avgReplyHours, value: share * replyRate + (1 - share) * speed };
}

/** Tier for a score; fewer than minReviewsForScore reviews is always "building". */
export function trustTier(score, reviewCount) {
  if (reviewCount < TRUST_CONFIG.minReviewsForScore) return 'building';
  return TRUST_CONFIG.tiers.find((t) => score >= t.min).id;
}

/**
 * @param {Object} input
 * @param {Array<{ rating: number, visited?: boolean, createdAt: Date|string, ownerReply?: { createdAt: Date|string }|null, authorId?: unknown }>} input.reviews  Published only.
 * @param {'phone'|'vouched'|'registered'} input.verificationLevel
 * @param {number} input.platformMean  Mean rating across the platform (m in the Bayesian average).
 * @param {(authorId: unknown) => Object|null} [input.getAuthor]
 * @param {number} [input.now]
 * @returns {{ score: number, tier: string, breakdown: Record<string, { score: number, weight: number, points: number }>, bayesianRating: number, responseRate: number, avgReplyHours: number|null }}
 */
export function computeTrustScore({ reviews, verificationLevel, platformMean, getAuthor = () => null, now = Date.now() }) {
  const n = reviews.length;
  const C = TRUST_CONFIG.bayesianPrior;
  const sum = reviews.reduce((acc, r) => acc + r.rating, 0);
  // Bayesian average: (C × m + Σ ratings) / (C + n). Few reviews stay close to the platform mean.
  const bayes = (C * platformMean + sum) / (C + n);
  const reply = responsiveness(reviews);

  const signals = {
    ratingQuality: clamp01((bayes - 1) / 4) ** TRUST_CONFIG.ratingCurve,
    reviewVolume: clamp01(Math.log1p(n) / Math.log1p(TRUST_CONFIG.fullVolumeAt)),
    reviewerCredibility: n ? reviews.reduce((acc, r) => acc + reviewerCredibility(r, getAuthor(r.authorId), now), 0) / n : 0,
    recency: n ? reviews.filter((r) => now - new Date(r.createdAt).getTime() < TRUST_CONFIG.recentDays * DAY_MS).length / n : 0,
    responsiveness: reply.value,
    verification: TRUST_CONFIG.verification[verificationLevel] ?? 0,
  };

  const breakdown = Object.fromEntries(
    Object.entries(TRUST_CONFIG.weights).map(([key, weight]) => [
      key,
      { score: Math.round(signals[key] * 1000) / 1000, weight, points: Math.round(signals[key] * weight * 1000) / 10 },
    ]),
  );
  const score = Math.round(Object.entries(TRUST_CONFIG.weights).reduce((acc, [key, w]) => acc + signals[key] * w, 0) * 100);

  return {
    score,
    tier: trustTier(score, n),
    breakdown,
    bayesianRating: Math.round(bayes * 100) / 100,
    responseRate: Math.round(reply.replyRate * 100) / 100,
    avgReplyHours: reply.avgReplyHours === null ? null : Math.round(reply.avgReplyHours * 10) / 10,
  };
}
