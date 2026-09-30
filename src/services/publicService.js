import { CATEGORIES, TIMEZONE } from '../config/constants.js';
import { Business, BusinessStatsDaily, Event, Follow, Post, Review, User } from '../models/index.js';
import { businessToCard } from '../utils/businessSerializers.js';
import { cached } from '../utils/cache.js';
import { CARD_FIELDS } from './businessQuery.js';

/*
 * Landing page data. Read-only, anonymous, and cached in memory for 5 minutes per
 * endpoint, so a busy landing page costs a handful of queries every few minutes.
 * Nothing here identifies a person beyond a public display name.
 */
const TTL = 5 * 60 * 1000;
const DAY = 86400000;
const published = { status: 'published' };

/** Start and end of the current calendar month in SAST, as UTC instants. */
function sastMonth(now = new Date()) {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit' }).format(now).split('-').map(Number);
  // SAST is UTC+2 with no daylight saving, so local midnight is 22:00 UTC the day before.
  return { start: new Date(Date.UTC(y, m - 1, 1) - 2 * 3600000), end: new Date(Date.UTC(y, m, 1) - 2 * 3600000) };
}

export const getStats = () =>
  cached('public:stats', TTL, async () => {
    const { start, end } = sastMonth();
    const [businesses, members, reviews, eventsThisMonth] = await Promise.all([
      Business.countDocuments(published),
      User.countDocuments({ status: 'active' }),
      Review.countDocuments({ status: 'published' }),
      Event.countDocuments({ status: 'scheduled', startsAt: { $gte: start, $lt: end } }),
    ]);
    return { businesses, members, reviews, eventsThisMonth };
  });

/** Three businesses for the hero: most trusted, with a photo and at least 5 reviews. */
export const getFeatured = () =>
  cached('public:featured', TTL, async () => {
    const rows = await Business.find({ ...published, 'cover.url': { $ne: null }, 'stats.reviewCount': { $gte: 5 } }, CARD_FIELDS)
      .sort({ 'trust.score': -1, _id: 1 })
      .limit(3)
      .lean();
    return rows.map((b) => businessToCard(b));
  });

/**
 * "Trending this week": engagement in the last 7 days. New reviews count 3, new follows
 * 2, profile views 0.1 each (from businessStatsDaily). Falls back to the most followed.
 */
export const getTrending = () =>
  cached('public:trending', TTL, async () => {
    const since = new Date(Date.now() - 7 * DAY);
    const sinceDay = since.toISOString().slice(0, 10);
    const [reviews, follows, views] = await Promise.all([
      Review.aggregate([{ $match: { status: 'published', createdAt: { $gte: since } } }, { $group: { _id: '$businessId', n: { $sum: 1 } } }]),
      Follow.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: '$businessId', n: { $sum: 1 } } }]),
      BusinessStatsDaily.aggregate([{ $match: { date: { $gte: sinceDay } } }, { $group: { _id: '$businessId', n: { $sum: '$views' } } }]),
    ]);
    const score = new Map();
    const add = (rows, weight) => rows.forEach((r) => score.set(String(r._id), (score.get(String(r._id)) ?? 0) + r.n * weight));
    add(reviews, 3);
    add(follows, 2);
    add(views, 0.1);
    const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id);
    let rows = await Business.find({ ...published, _id: { $in: ranked } }, CARD_FIELDS).lean();
    rows.sort((a, b) => ranked.indexOf(String(a._id)) - ranked.indexOf(String(b._id)));
    if (rows.length < 8) {
      const fill = await Business.find({ ...published, _id: { $nin: rows.map((r) => r._id) } }, CARD_FIELDS)
        .sort({ 'stats.followerCount': -1, _id: 1 })
        .limit(8 - rows.length)
        .lean();
      rows = [...rows, ...fill];
    }
    return rows.map((b) => businessToCard(b));
  });

/** Last 20 things that happened: reviews (by display name) and newly listed businesses. */
export const getActivity = () =>
  cached('public:activity', TTL, async () => {
    const [reviews, joined] = await Promise.all([
      Review.find({ status: 'published' }, { businessId: 1, authorId: 1, rating: 1, createdAt: 1 }).sort({ createdAt: -1 }).limit(20).lean(),
      Business.find(published, { name: 1, slug: 1, category: 1, publishedAt: 1 }).sort({ publishedAt: -1 }).limit(20).lean(),
    ]);
    const [authors, businesses] = await Promise.all([
      User.find({ _id: { $in: reviews.map((r) => r.authorId).filter(Boolean) } }, { displayName: 1 }).lean(),
      Business.find({ _id: { $in: reviews.map((r) => r.businessId) } }, { name: 1, slug: 1 }).lean(),
    ]);
    const nameOf = new Map(authors.map((u) => [String(u._id), u.displayName]));
    const biz = new Map(businesses.map((b) => [String(b._id), b]));
    const items = [
      ...reviews
        .filter((r) => biz.has(String(r.businessId)))
        .map((r) => ({
          type: 'review',
          at: r.createdAt,
          displayName: nameOf.get(String(r.authorId)) ?? 'Former member',
          rating: r.rating,
          business: { name: biz.get(String(r.businessId)).name, slug: biz.get(String(r.businessId)).slug },
        })),
      ...joined.map((b) => ({ type: 'joined', at: b.publishedAt, business: { name: b.name, slug: b.slug, category: b.category } })),
    ];
    return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 20);
  });

/** Current Kasi Spotlight (running now), else the most recent one. */
export const getSpotlight = () =>
  cached('public:spotlight', TTL, async () => {
    const now = new Date();
    const post =
      (await Post.findOne({ type: 'spotlight', status: 'published', 'spotlight.from': { $lte: now }, 'spotlight.to': { $gt: now } }).sort({ 'spotlight.from': -1 }).lean()) ??
      (await Post.findOne({ type: 'spotlight', status: 'published' }).sort({ 'spotlight.from': -1 }).lean());
    if (!post?.businessId) return null;
    const business = await Business.findOne({ _id: post.businessId, ...published }, { ...CARD_FIELDS, ownerName: 1, since: 1 }).lean();
    if (!business) return null;
    return {
      title: post.title,
      story: post.spotlight?.story ?? post.body,
      quote: post.spotlight?.quote ?? null,
      from: post.spotlight?.from ?? post.createdAt,
      to: post.spotlight?.to ?? null,
      business: { ...businessToCard(business), ownerName: business.ownerName, since: business.since },
    };
  });

/** Every category with its number of published businesses (0 included). */
export const getCategories = () =>
  cached('public:categories', TTL, async () => {
    const counts = await Business.aggregate([{ $match: published }, { $group: { _id: '$category', n: { $sum: 1 } } }]);
    const byId = new Map(counts.map((c) => [c._id, c.n]));
    return CATEGORIES.map((id) => ({ id, count: byId.get(id) ?? 0 }));
  });
