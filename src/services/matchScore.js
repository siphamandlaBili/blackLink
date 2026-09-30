/**
 * "Best match" for the Nearby Finder. A weighted mix of signals, each normalised to 0–1.
 * All weights and thresholds live in MATCH_CONFIG so they can be tuned in one place.
 *
 *   score = Σ weight × signal
 *   distance    1 at the user's spot, 0 at the edge of the search radius
 *   trust       Trust Score / 100 (businesses still "building trust" count as 0.5)
 *   rating      Bayesian-ish: (rating − 1) / 4, damped when there are few reviews
 *   popularity  log(followers) relative to the most-followed result in this search
 *   open        1 open, 0.6 closing soon, 0 closed
 *   interest    1 if the category is one the user picked or follows, else 0
 */
export const MATCH_CONFIG = Object.freeze({
  weights: Object.freeze({ distance: 0.3, trust: 0.2, rating: 0.15, popularity: 0.1, open: 0.1, interest: 0.15 }),
  buildingTrustValue: 0.5,
  fewReviews: 5,
  reasons: Object.freeze({ trustedTiers: ['trusted', 'high'], topRating: 4.5, max: 4 }),
});

const clamp01 = (x) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));

/**
 * @param {Object} b             Business with distanceM, stats, trust, category, openStatus.
 * @param {Object} ctx
 * @param {number} ctx.radiusM
 * @param {number} ctx.maxFollowers  Highest follower count among the candidates.
 * @param {Set<string>} ctx.interests Categories the user picked or follows.
 * @returns {{ score: number, signals: Record<string, number> }}
 */
export function matchScore(b, { radiusM, maxFollowers, interests }) {
  const reviews = b.stats?.reviewCount ?? 0;
  const signals = {
    distance: clamp01(1 - b.distanceM / radiusM),
    trust: b.trust?.tier === 'building' ? MATCH_CONFIG.buildingTrustValue : clamp01((b.trust?.score ?? 0) / 100),
    rating: clamp01(((b.stats?.rating ?? 0) - 1) / 4) * Math.min(1, reviews / MATCH_CONFIG.fewReviews),
    popularity: maxFollowers > 0 ? clamp01(Math.log1p(b.stats?.followerCount ?? 0) / Math.log1p(maxFollowers)) : 0,
    open: { open: 1, closingSoon: 0.6 }[b.openStatus?.status] ?? 0,
    interest: interests.has(b.category) ? 1 : 0,
  };
  const score = Object.entries(MATCH_CONFIG.weights).reduce((acc, [k, w]) => acc + w * signals[k], 0);
  return { score: Math.round(score * 1000) / 1000, signals };
}

/**
 * "Why this suggestion": short machine-readable reasons the client turns into text,
 * e.g. [{ code: 'distance', distanceM: 800 }, { code: 'open' }, { code: 'trusted' }].
 * Distance always comes first; the rest follow in order of how much they helped.
 */
export function matchReasons(b, signals) {
  const out = [{ code: 'distance', distanceM: Math.round(b.distanceM) }];
  const candidates = [
    b.openStatus?.status === 'open' && { code: 'open', weight: signals.open },
    b.openStatus?.status === 'closingSoon' && { code: 'closingSoon', closesAt: b.openStatus.closesAt, weight: 0.05 },
    MATCH_CONFIG.reasons.trustedTiers.includes(b.trust?.tier) && { code: 'trusted', tier: b.trust.tier, weight: signals.trust },
    (b.stats?.rating ?? 0) >= MATCH_CONFIG.reasons.topRating && (b.stats?.reviewCount ?? 0) >= MATCH_CONFIG.fewReviews && { code: 'topRated', rating: b.stats.rating, weight: signals.rating },
    signals.interest === 1 && { code: 'interest', weight: 1 },
    b.hasActiveOffer && { code: 'offer', weight: 0.1 },
  ].filter(Boolean);
  candidates.sort((x, y) => y.weight - x.weight);
  for (const { weight, ...reason } of candidates.slice(0, MATCH_CONFIG.reasons.max - 1)) out.push(reason);
  return out;
}
