import { createHash } from 'node:crypto';
import { Report, Review, User } from '../models/index.js';

/**
 * Automatic flags for suspicious reviews. A flagged review stays visible (status
 * "flagged" still counts) and lands in the moderation queue as an `auto: true` report.
 * Negative reviews are never flagged for being negative, only for these patterns.
 * All thresholds live here.
 */
export const MODERATION_CONFIG = Object.freeze({
  burst: { count: 5, windowMs: 60 * 60 * 1000 }, // 5+ reviews for one business within an hour
  newAccounts: { count: 3, accountAgeMs: 24 * 3600 * 1000, windowMs: 24 * 3600 * 1000 }, // 3+ from accounts under 24 h old
  // Near-duplicates: texts that match after lower-casing and dropping punctuation, numbers
  // and extra spaces (catches copy-paste with small tweaks like "!!!" or "5 stars").
  duplicate: { minLength: 20 },
});

// Filler words dropped before fingerprinting, so "good and cheap" matches "good & cheap".
const FILLER = new Set(['a', 'an', 'and', 'the', 'at', 'in', 'on', 'of', 'to', 'for', 'is', 'it', 'was', 'very', 'really', 'so']);

/**
 * Normalised-text fingerprint used to spot near-duplicate reviews. Internal only.
 * Lower-cases, strips accents, turns "&" into "and", keeps letters only and drops filler
 * words, so copies with changed punctuation, capitals, numbers or "&" still match.
 */
export function textHash(text = '') {
  const words = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !FILLER.has(w));
  const normalised = words.join(' ');
  if (normalised.length < MODERATION_CONFIG.duplicate.minLength) return null;
  return createHash('sha256').update(normalised).digest('hex');
}

/** Burst and new-account patterns for one business. Pushes reasons into `reasons`. */
async function checkVolume(review, s, now, reasons) {
  const { burst, newAccounts } = MODERATION_CONFIG;
  const recent = await Review.countDocuments({ businessId: review.businessId, createdAt: { $gte: new Date(now - burst.windowMs) } }).session(s);
  if (recent >= burst.count) reasons.push('auto_burst');

  const windowReviews = await Review.find(
    { businessId: review.businessId, createdAt: { $gte: new Date(now - newAccounts.windowMs) }, authorId: { $ne: null } },
    { authorId: 1 },
  )
    .session(s)
    .lean();
  if (windowReviews.length >= newAccounts.count) {
    const young = await User.countDocuments({
      _id: { $in: windowReviews.map((r) => r.authorId) },
      createdAt: { $gte: new Date(now - newAccounts.accountAgeMs) },
    }).session(s);
    if (young >= newAccounts.count) reasons.push('auto_new_accounts');
  }
}

/**
 * Checks a just-written review and flags it if needed. Runs inside the review's transaction.
 * @param {Object} review  The saved review with _id, businessId, authorId and textHash.
 * @param {import('mongoose').ClientSession} session
 * @param {{ only?: 'duplicate' }} [options] Edits re-check duplicates only, so editing an old review can't trip the volume rules.
 * @returns {Promise<string[]>} Reasons it was flagged (empty when clean).
 */
export async function autoModerate(review, session, { only } = {}, now = Date.now()) {
  const reasons = [];
  const s = session ?? null;
  if (only !== 'duplicate') await checkVolume(review, s, now, reasons);

  if (review.textHash) {
    const twin = await Review.exists({ _id: { $ne: review._id }, textHash: review.textHash, authorId: { $ne: review.authorId } }).session(s);
    if (twin) reasons.push('auto_duplicate');
  }

  if (reasons.length) {
    await Review.updateOne({ _id: review._id }, { $set: { status: 'flagged' } }, { session, timestamps: false });
    for (const reason of reasons) {
      // One open automatic report per review and reason (unique partial index), so re-checks don't pile up.
      await Report.updateOne(
        { targetType: 'review', targetId: review._id, reason, auto: true, status: 'open' },
        { $setOnInsert: { reporterId: null, details: 'Raised automatically' } },
        { upsert: true, session },
      );
    }
  }
  return reasons;
}
