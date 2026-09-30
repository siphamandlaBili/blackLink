import { Business, BusinessStatsDaily, Event, Follow, Offer, Review, User } from '../models/index.js';
import { forbidden, notFound } from '../utils/errors.js';
import { sastDay } from '../jobs/trustRefresh.js';
import { computeTrustScore } from './trustScore.js';
import { COUNTED, platformMean } from './trustRecalc.js';

const DAY = 86400000;
const METRICS = ['views', 'whatsappClicks', 'callClicks', 'directionsClicks', 'websiteClicks'];

/** Every SAST day from `days - 1` days ago to today, as "YYYY-MM-DD". */
const dayList = (days, now) => Array.from({ length: days }, (_, i) => sastDay(new Date(now.getTime() - (days - 1 - i) * DAY)));

function totals(rows) {
  return Object.fromEntries(METRICS.map((m) => [m, rows.reduce((acc, r) => acc + (r[m] ?? 0), 0)]));
}

/**
 * Trust Score trend, one point a week. There's no stored history: the score is replayed
 * from the reviews as they stood at the end of each week (and only replies already made by
 * then), with the same pure function the live score uses.
 */
function trustTrend(reviews, business, authors, mean, now, days) {
  const weeks = Math.ceil(days / 7);
  const byId = new Map(authors.map((a) => [String(a._id), a]));
  return Array.from({ length: weeks + 1 }, (_, i) => {
    const at = new Date(now.getTime() - (weeks - i) * 7 * DAY);
    const asOf = reviews
      .filter((r) => new Date(r.createdAt) <= at)
      .map((r) => ({ ...r, ownerReply: r.ownerReply && new Date(r.ownerReply.createdAt) <= at ? r.ownerReply : null }));
    const t = computeTrustScore({ reviews: asOf, verificationLevel: business.verification.level, platformMean: mean, getAuthor: (id) => byId.get(String(id)) ?? null, now: at.getTime() });
    return { date: sastDay(at), score: t.score, tier: t.tier, reviews: asOf.length };
  });
}

/** Average rating of each week's new reviews, plus the running overall average. */
function ratingTrend(reviews, now, days) {
  const weeks = Math.ceil(days / 7);
  return Array.from({ length: weeks }, (_, i) => {
    const end = new Date(now.getTime() - (weeks - 1 - i) * 7 * DAY);
    const start = new Date(end.getTime() - 7 * DAY);
    const week = reviews.filter((r) => new Date(r.createdAt) > start && new Date(r.createdAt) <= end);
    const upTo = reviews.filter((r) => new Date(r.createdAt) <= end);
    const avg = (list) => (list.length ? Math.round((list.reduce((a, r) => a + r.rating, 0) / list.length) * 10) / 10 : null);
    return { weekEnding: sastDay(end), newReviews: week.length, weekAverage: avg(week), overallAverage: avg(upTo) };
  });
}

/**
 * GET /dashboard/:businessId?range=30|90 — the owner's view of how their listing is doing.
 * Owner (or admin) only; the check is here, not just in the route.
 */
export async function getDashboard(businessId, user, { range }, now = new Date()) {
  const business = await Business.findOne({ _id: businessId, status: { $ne: 'deleted' } }).lean();
  if (!business) throw notFound('Business not found');
  if (user.role !== 'admin' && String(business.ownerId) !== String(user._id)) throw forbidden('Only the owner can see this dashboard');

  const days = dayList(range, now);
  const previousDays = dayList(range * 2, now).slice(0, range);
  const since = new Date(now.getTime() - range * DAY);
  const [daily, previous, reviews, followersGained, activeOffers, upcomingEvents] = await Promise.all([
    BusinessStatsDaily.find({ businessId, date: { $gte: days[0] } }, { _id: 0, businessId: 0 }).lean(),
    BusinessStatsDaily.find({ businessId, date: { $gte: previousDays[0], $lt: days[0] } }, { _id: 0, businessId: 0 }).lean(),
    Review.find({ businessId, status: COUNTED }, { rating: 1, subRatings: 1, visited: 1, createdAt: 1, ownerReply: 1, authorId: 1, text: 1 }).sort({ createdAt: 1 }).lean(),
    Follow.countDocuments({ businessId, createdAt: { $gte: since } }),
    Offer.countDocuments({ businessId, status: 'active', $or: [{ endsAt: null }, { endsAt: { $gt: now } }] }),
    Event.countDocuments({ businessId, status: 'scheduled', startsAt: { $gt: now } }),
  ]);

  const byDay = new Map(daily.map((d) => [d.date, d]));
  const series = days.map((date) => ({ date, ...Object.fromEntries(METRICS.map((m) => [m, byDay.get(date)?.[m] ?? 0])) }));
  const authors = await User.find({ _id: { $in: [...new Set(reviews.map((r) => String(r.authorId)).filter((x) => x !== 'null'))] } }, { emailVerified: 1, createdAt: 1, helpfulVotesReceived: 1, displayName: 1 }).lean();
  const names = new Map(authors.map((a) => [String(a._id), a.displayName]));
  const unanswered = reviews.filter((r) => !r.ownerReply).reverse();

  return {
    business: { id: String(business._id), name: business.name, slug: business.slug, status: business.status },
    range,
    engagement: { totals: totals(daily), previousTotals: totals(previous), series },
    followers: { total: business.stats.followerCount, gained: followersGained },
    reviews: {
      total: business.stats.reviewCount,
      rating: business.stats.rating,
      distribution: business.stats.distribution,
      newInRange: reviews.filter((r) => new Date(r.createdAt) >= since).length,
      responseRate: business.stats.responseRate,
      avgReplyHours: business.stats.avgReplyHours,
      unansweredCount: unanswered.length,
      unanswered: unanswered.slice(0, 20).map((r) => ({ id: String(r._id), rating: r.rating, text: r.text.slice(0, 280), author: names.get(String(r.authorId)) ?? 'Former member', createdAt: r.createdAt })),
      ratingOverTime: ratingTrend(reviews, now, range),
    },
    trust: {
      score: business.trust.tier === 'building' ? null : business.trust.score,
      tier: business.trust.tier,
      breakdown: business.trust.breakdown,
      trend: trustTrend(reviews, business, authors, await platformMean(), now, range),
    },
    activeOffers,
    upcomingEvents,
  };
}
