import { VERIFICATION_LEVELS } from '../config/constants.js';
import { Business, Follow } from '../models/index.js';
import { businessToCard } from '../utils/businessSerializers.js';
import { toPoint } from '../utils/geo.js';
import { afterCursor, offsetCursor, offsetFrom, pageOf, sortObject } from '../utils/pagination.js';
import { matchReasons, matchScore } from './matchScore.js';
import { openNowFilter, openStatus } from './openNow.js';

const NEW_DAYS = 30;
// Fields a card needs. Everything else stays in the database.
export const CARD_FIELDS = {
  slug: 1, name: 1, category: 1, tags: 1, description: 1, cover: 1, logo: 1, township: 1, location: 1,
  priceLevel: 1, 'verification.level': 1, stats: 1, trust: 1, hasActiveOffer: 1, backupPower: 1, publishedAt: 1, hours: 1,
  nameLower: 1, // A–Z sort key and cursor; never serialized.
};

const SORTS = {
  rated: [['stats.rating', -1], ['stats.reviewCount', -1], ['_id', -1]],
  trusted: [['trust.score', -1], ['_id', -1]],
  newest: [['publishedAt', -1], ['_id', -1]],
  popular: [['stats.followerCount', -1], ['_id', -1]],
  az: [['nameLower', 1], ['_id', 1]],
};

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Mongo filter for the shared directory/Nearby filters. Only published listings, always. */
export function buildFilter(f, now = new Date()) {
  const filter = { status: 'published' };
  if (f.category?.length) filter.category = { $in: f.category };
  if (f.township?.length) filter.township = { $in: f.township };
  if (f.minRating) filter['stats.rating'] = { $gte: f.minRating };
  if (f.minTrust) Object.assign(filter, { 'trust.score': { $gte: f.minTrust }, 'trust.tier': { $ne: 'building' } });
  if (f.price?.length) filter.priceLevel = { $in: f.price };
  if (f.verification) filter['verification.level'] = { $in: VERIFICATION_LEVELS.slice(VERIFICATION_LEVELS.indexOf(f.verification)) };
  if (f.newThisMonth) filter.publishedAt = { $gte: new Date(now - NEW_DAYS * 86400000) };
  if (f.hasOffers) filter.hasActiveOffer = true;
  if (f.backupPower) filter.backupPower = true;
  if (f.openNow) Object.assign(filter, openNowFilter(now));
  return filter;
}

/** The "following" flag for the signed-in viewer, for a set of business ids. */
export async function viewerFlags(user, ids) {
  if (!user || !ids.length) return null;
  const follows = await Follow.find({ userId: user._id, businessId: { $in: ids } }, { businessId: 1 }).lean();
  const following = new Set(follows.map((f) => String(f.businessId)));
  return (bid) => ({ following: following.has(String(bid)) });
}

async function toCards(rows, user, now) {
  const flags = await viewerFlags(user, rows.map((r) => r._id));
  return rows.map((b) => businessToCard(b, { now, viewer: flags?.(b._id) }));
}

/**
 * GET /businesses — search, filters, sorts, cursor pagination.
 *
 * Search: MongoDB $text over name/tags/description (ranked by relevance). Queries shorter
 * than 3 characters, or text searches with no hits, fall back to a case-insensitive
 * prefix match on the name ("sak" → Sakhumzi).
 */
export async function listBusinesses(query, user, now = new Date()) {
  const { q, limit, cursor } = query;
  const base = buildFilter(query, now);
  const useText = q && q.length >= 3;
  const sortKey = query.sort ?? (q ? 'relevance' : 'rated');

  if (useText && sortKey === 'relevance') {
    // Relevance has no stable sort key, so this ordering pages by offset.
    const offset = offsetFrom(cursor);
    const rows = await Business.find({ ...base, $text: { $search: q } }, { ...CARD_FIELDS, score: { $meta: 'textScore' } })
      .sort({ score: { $meta: 'textScore' }, _id: -1 })
      .skip(offset)
      .limit(limit + 1)
      .lean();
    if (rows.length || offset > 0) {
      const hasMore = rows.length > limit;
      const items = rows.slice(0, limit);
      const total = offset === 0 ? await Business.countDocuments({ ...base, $text: { $search: q } }) : undefined;
      return { items: await toCards(items, user, now), nextCursor: hasMore ? offsetCursor(offset + limit) : null, total };
    }
  }

  const sort = SORTS[sortKey] ?? SORTS.rated;
  const filter = { ...base };
  if (q) {
    // Text search (with a keyed sort) or the name-prefix fallback.
    if (useText && sortKey !== 'relevance' && (await Business.exists({ ...base, $text: { $search: q } }))) filter.$text = { $search: q };
    else filter.nameLower = { $regex: `^${escapeRegex(q.toLowerCase())}` };
  }
  const page = await Business.find({ ...filter, ...afterCursor(cursor, sort) }, CARD_FIELDS)
    .sort(sortObject(sort))
    .limit(limit + 1)
    .lean();
  const { items, nextCursor } = pageOf(page, limit, sort);
  // The total is only counted for the first page: it's what the "N businesses" line needs.
  const total = cursor ? undefined : await Business.countDocuments(filter);
  return { items: await toCards(items, user, now), nextCursor, total };
}

// Upper bound on candidates scored per Nearby search. Soweto's density keeps this well above
// what any 20 km radius holds today; raise it (or pre-filter harder) as the directory grows.
const NEARBY_CANDIDATES = 500;

/**
 * GET /businesses/nearby — $geoNear within the radius (first stage), filters, then
 * open status and Best-match scoring. The visitor's coordinates are used for this query
 * only: never stored, never logged.
 */
export async function nearbyBusinesses(query, user, now = new Date()) {
  const { lat, lng, radiusKm, sort, limit } = query;
  const radiusM = radiusKm * 1000;
  const candidates = await Business.aggregate([
    {
      $geoNear: {
        near: toPoint(lat, lng),
        distanceField: 'distanceM',
        maxDistance: radiusM,
        spherical: true,
        query: buildFilter(query, now),
      },
    },
    { $limit: NEARBY_CANDIDATES },
    { $project: { ...CARD_FIELDS, distanceM: 1 } },
  ]);

  // Interests: categories the user picked plus categories of businesses they follow.
  // Guests (and members) may also send the interests picked on this device.
  const interests = new Set([...(user?.preferences?.categories ?? []), ...(query.interests ?? [])]);
  if (user) {
    const followed = await Follow.find({ userId: user._id }, { businessId: 1 }).limit(200).lean();
    if (followed.length) {
      const cats = await Business.distinct('category', { _id: { $in: followed.map((f) => f.businessId) } });
      cats.forEach((c) => interests.add(c));
    }
  }

  const maxFollowers = Math.max(0, ...candidates.map((b) => b.stats?.followerCount ?? 0));
  const scored = candidates.map((b) => {
    const withStatus = { ...b, openStatus: openStatus(b.hours, now) };
    const { score, signals } = matchScore(withStatus, { radiusM, maxFollowers, interests });
    return { b, score, reasons: matchReasons(withStatus, signals) };
  });

  const by = {
    best: (x, y) => y.score - x.score,
    distance: (x, y) => x.b.distanceM - y.b.distanceM,
    rated: (x, y) => (y.b.stats?.rating ?? 0) - (x.b.stats?.rating ?? 0) || x.b.distanceM - y.b.distanceM,
    trusted: (x, y) => (y.b.trust?.score ?? 0) - (x.b.trust?.score ?? 0) || x.b.distanceM - y.b.distanceM,
    popular: (x, y) => (y.b.stats?.followerCount ?? 0) - (x.b.stats?.followerCount ?? 0) || x.b.distanceM - y.b.distanceM,
    newest: (x, y) => new Date(y.b.publishedAt) - new Date(x.b.publishedAt),
  }[sort];
  scored.sort(by);

  const top = scored.slice(0, limit);
  const flags = await viewerFlags(user, top.map((s) => s.b._id));
  return {
    items: top.map(({ b, score, reasons }) => ({ ...businessToCard(b, { now, viewer: flags?.(b._id) }), matchScore: score, reasons })),
    meta: { total: candidates.length, radiusKm, sort },
  };
}
