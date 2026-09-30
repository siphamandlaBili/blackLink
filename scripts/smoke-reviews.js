// Phase 4 smoke test (NODE_ENV=test, seeded database): reviews, helpful votes, owner
// replies, reports, auto-moderation, and the Trust Score as a pure function.
//   NODE_ENV=test npm run smoke:reviews
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Business, Report, Review, ReviewVote, User } from '../src/models/index.js';
import { registerTestClerkUser } from '../src/services/clerk.js';
import { recalcBusiness } from '../src/services/trustRecalc.js';
import { computeTrustScore, trustTier } from '../src/services/trustScore.js';

if (process.env.NODE_ENV !== 'test') throw new Error('Run with NODE_ENV=test');
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
};

await connectDb();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
const api = async (path, { as, method = 'GET', body } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(as ? { 'X-Test-Clerk-Id': as } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};
const person = (key, extra = {}) => registerTestClerkUser({ clerkId: `user_rv_${key}`, email: `${key}@rv-smoke.test`, emailVerified: true, firstName: key.toUpperCase(), lastName: 'Tester', avatarUrl: null, ...extra });
['a', 'b', 'c', 'd', 'e1', 'e2', 'e3', 'e4', 'e5'].forEach((k) => person(k));
person('unv', { emailVerified: false });
// The seeded owner of Kasi Threads signs in with Clerk: their account is linked by email.
registerTestClerkUser({ clerkId: 'user_rv_owner', email: 'owner.kasi-threads-tailoring@seed.blacklink.test', emailVerified: true, firstName: 'Nomsa', lastName: 'Khumalo', avatarUrl: null });

const biz = async (slug) => Business.findOne({ slug }).lean();
const A = await biz('kasi-threads-tailoring');
const [lng, lat] = A.location.coordinates;
const text = (n) => `Honest review number ${n}: good service, fair price and friendly people at the counter.`;
const touched = new Set([String(A._id)]);

// --- Rules ---
let r = await api(`/businesses/${A._id}/reviews`, { method: 'POST', body: { rating: 5, text: text(0) } });
check('signed out → 401', r.status === 401);
r = await api(`/businesses/${A._id}/reviews`, { as: 'user_rv_unv', method: 'POST', body: { rating: 5, text: text(0) } });
check('unverified email → 403 EMAIL_NOT_VERIFIED', r.status === 403 && r.body.error.code === 'EMAIL_NOT_VERIFIED');
r = await api(`/businesses/${A._id}/reviews`, { as: 'user_rv_owner', method: 'POST', body: { rating: 5, text: text(0) } });
check("owner can't review their own business → 403", r.status === 403);
for (const [label, body] of [['text under 20 chars', { rating: 5, text: 'Too short' }], ['client-sent visited', { rating: 5, text: text(1), visited: true }], ['client-sent helpfulCount', { rating: 5, text: text(1), helpfulCount: 99 }], ['rating 6', { rating: 6, text: text(1) }], ['"$" key', { rating: 5, text: text(1), $set: { status: 'published' } }]]) {
  r = await api(`/businesses/${A._id}/reviews`, { as: 'user_rv_a', method: 'POST', body });
  check(`rejects ${label} → 400`, r.status === 400);
}

// --- Create, Visited, recalculation ---
const before = await biz('kasi-threads-tailoring');
r = await api(`/businesses/${A._id}/reviews`, { as: 'user_rv_a', method: 'POST', body: { rating: 1, text: text(1), tags: ['Slow service'], location: { lat: lat + 0.0005, lng } } });
const reviewA = r.body?.data;
check('create → 201, within 150 m marks Visited', r.status === 201 && reviewA.visited === true && reviewA.author.displayName === 'A T.');
let after = await biz('kasi-threads-tailoring');
check('business stats and Trust Score recalculated', after.stats.reviewCount === before.stats.reviewCount + 1 && after.trust.calculatedAt > before.trust.calculatedAt && after.stats.rating !== before.stats.rating);
let author = await User.findOne({ clerkId: 'user_rv_a' }).lean();
check('author count and First Review badge', author.reviewCount === 1 && author.badges.includes('first-review'));
const stored = await Review.findById(reviewA.id).lean();
check('coordinates are never stored', !JSON.stringify(stored).match(/"lat"|"lng"|coordinates|location/));
r = await api(`/businesses/${A._id}/reviews`, { as: 'user_rv_a', method: 'POST', body: { rating: 4, text: text(2) } });
check('second review of the same business → 409 with the existing id', r.status === 409 && r.body.error.details?.reviewId === reviewA.id);
r = await api(`/businesses/${A._id}/reviews`, { as: 'user_rv_b', method: 'POST', body: { rating: 4, text: text(3), location: { lat: lat + 0.01, lng } } });
const reviewB = r.body?.data;
check('more than 150 m away → not Visited', r.status === 201 && reviewB.visited === false);

// --- List ---
r = await api(`/businesses/${A._id}/reviews?sort=newest&limit=5`, { as: 'user_rv_a' });
check('list: newest first, viewer flags, myReviewId', r.status === 200 && r.body.data[0].id === reviewB.id && r.body.meta.myReviewId === reviewA.id && r.body.data.find((x) => x.id === reviewA.id)?.viewer.mine === true);
r = await api(`/businesses/${A._id}/reviews?stars=1&limit=50`);
check('list: stars=1 filter', r.body.data.length >= 1 && r.body.data.every((x) => x.rating === 1));
r = await api(`/businesses/${A._id}/reviews?visited=true&limit=50`);
check('list: visited=true filter', r.body.data.every((x) => x.visited));
const seen = new Set();
let cursor = null;
do {
  r = await api(`/businesses/${A._id}/reviews?sort=helpful&limit=4${cursor ? `&cursor=${cursor}` : ''}`);
  r.body.data.forEach((x) => seen.add(x.id));
  cursor = r.body.meta.nextCursor;
} while (cursor);
check('list: cursor paging returns every review once', seen.size === after.stats.reviewCount + 1, `${seen.size}`);
check('list: no private fields', !/textHash|@rv-smoke|@seed\.blacklink|clerkId|"status"|authorId/.test(JSON.stringify(r.body)));

// --- Edit ---
r = await api(`/reviews/${reviewA.id}`, { as: 'user_rv_b', method: 'PATCH', body: { rating: 5 } });
check("edit someone else's review → 403", r.status === 403);
r = await api(`/reviews/${reviewA.id}`, { as: 'user_rv_a', method: 'PATCH', body: { rating: 5, text: `${text(1)} Came back and it was much better.` } });
after = await biz('kasi-threads-tailoring');
check('edit by author → "edited", Visited kept, stats updated', r.status === 200 && r.body.data.edited && r.body.data.visited && r.body.data.rating === 5 && after.stats.distribution['5'] > before.stats.distribution['5']);

// --- Helpful ---
r = await api(`/reviews/${reviewA.id}/helpful`, { as: 'user_rv_a', method: 'POST' });
check("helpful on your own review → 403", r.status === 403);
await api(`/reviews/${reviewA.id}/helpful`, { as: 'user_rv_b', method: 'POST' });
r = await api(`/reviews/${reviewA.id}/helpful`, { as: 'user_rv_b', method: 'POST' });
author = await User.findOne({ clerkId: 'user_rv_a' }).lean();
check('helpful twice counts once; author credited', r.body.data.helpfulCount === 1 && author.helpfulVotesReceived === 1);
r = await api(`/reviews/${reviewA.id}/helpful`, { as: 'user_rv_b', method: 'DELETE' });
check('un-helpful → back to 0', r.body.data.helpfulCount === 0);

// --- Owner reply ---
r = await api(`/reviews/${reviewA.id}/reply`, { as: 'user_rv_b', method: 'PUT', body: { text: 'Not my business' } });
check('reply by a non-owner → 403', r.status === 403);
const rateBefore = (await biz('kasi-threads-tailoring')).stats.responseRate;
r = await api(`/reviews/${reviewA.id}/reply`, { as: 'user_rv_owner', method: 'PUT', body: { text: 'Thank you for coming back to us!' } });
const firstReply = r.body?.data?.ownerReply;
r = await api(`/reviews/${reviewA.id}/reply`, { as: 'user_rv_owner', method: 'PUT', body: { text: 'Thank you for coming back to us! See you soon.' } });
check('owner reply: created, then edited (one reply)', r.status === 200 && r.body.data.ownerReply.createdAt === firstReply.createdAt && r.body.data.ownerReply.text.endsWith('soon.'));
check('reply updates response rate', (await biz('kasi-threads-tailoring')).stats.responseRate !== rateBefore);

// --- Report ---
r = await api(`/reviews/${reviewA.id}/report`, { as: 'user_rv_owner', method: 'POST', body: { reason: 'fake', details: 'Never seen this customer' } });
check('owner can report a review → 201', r.status === 201 && r.body.data.status === 'open');
r = await api(`/reviews/${reviewA.id}/report`, { as: 'user_rv_owner', method: 'POST', body: { reason: 'spam' } });
check('reporting twice → 409', r.status === 409);
r = await api(`/reviews/${reviewA.id}/report`, { as: 'user_rv_b', method: 'POST', body: { reason: 'i-dont-like-it' } });
check('unknown report reason → 400', r.status === 400);

// --- 5 per day ---
const others = await Business.find({ status: 'published', slug: { $nin: ['kasi-threads-tailoring', 'jabu-test'] } }).sort({ slug: 1 }).limit(8).lean();
for (let i = 0; i < 5; i += 1) {
  touched.add(String(others[i]._id));
  r = await api(`/businesses/${others[i]._id}/reviews`, { as: 'user_rv_c', method: 'POST', body: { rating: 4, text: `${text(10 + i)} Visit ${i}.` } });
}
r = await api(`/businesses/${others[5]._id}/reviews`, { as: 'user_rv_c', method: 'POST', body: { rating: 4, text: text(99) } });
check('sixth review in 24 hours → 429 REVIEW_LIMIT', r.status === 429 && r.body.error.code === 'REVIEW_LIMIT');
r = await api('/me/reviews', { as: 'user_rv_c' });
check('/me/reviews lists them with business names', r.body.data.length === 5 && r.body.data.every((x) => x.business?.name));

// --- Auto-moderation ---
touched.add(String(others[6]._id));
r = await api(`/businesses/${others[6]._id}/reviews`, { as: 'user_rv_d', method: 'POST', body: { rating: 5, text: `HONEST review number 1 -- good service, fair price & friendly people at the counter!!! Came back and it was much better.` } });
let flagged = await Review.findById(r.body.data.id).lean();
check('near-duplicate text → flagged, auto report', flagged.status === 'flagged' && (await Report.exists({ targetId: flagged._id, reason: 'auto_duplicate', auto: true })));
const Z = others[7];
touched.add(String(Z._id));
const burst = [];
for (const k of ['e1', 'e2', 'e3', 'e4', 'e5']) {
  r = await api(`/businesses/${Z._id}/reviews`, { as: `user_rv_${k}`, method: 'POST', body: { rating: 5, text: `Amazing place, ${k} says the best in the whole of Soweto township.` } });
  burst.push(r.body.data.id);
}
const third = await Review.findById(burst[2]).lean();
const fifth = await Review.findById(burst[4]).lean();
check('3 reviews from accounts under 24 h → flagged', third.status === 'flagged' && (await Report.exists({ targetId: third._id, reason: 'auto_new_accounts' })));
check('5 reviews within an hour → burst flag', fifth.status === 'flagged' && (await Report.exists({ targetId: fifth._id, reason: 'auto_burst' })));
r = await api(`/businesses/${Z._id}/reviews?sort=newest&limit=10`);
check('flagged reviews stay visible', burst.every((id) => r.body.data.some((x) => x.id === id)));

// --- Delete ---
const countBefore = (await biz('kasi-threads-tailoring')).stats.reviewCount;
r = await api(`/reviews/${reviewA.id}`, { as: 'user_rv_b', method: 'DELETE' });
check("delete someone else's review → 403", r.status === 403);
r = await api(`/reviews/${reviewA.id}`, { as: 'user_rv_a', method: 'DELETE' });
author = await User.findOne({ clerkId: 'user_rv_a' }).lean();
check('delete by author → stats and author count recalculated', r.status === 200 && (await biz('kasi-threads-tailoring')).stats.reviewCount === countBefore - 1 && author.reviewCount === 0);

// --- Trust Score (pure) ---
const mk = (n, rating, extra = {}) => Array.from({ length: n }, (_, i) => ({ rating, createdAt: new Date(Date.now() - i * 86400000), ...extra }));
check('fewer than 5 reviews → "building"', computeTrustScore({ reviews: mk(4, 5), verificationLevel: 'registered', platformMean: 4.2 }).tier === 'building');
check('tier thresholds', trustTier(85, 10) === 'high' && trustTier(84, 10) === 'trusted' && trustTier(69, 10) === 'good' && trustTier(49, 10) === 'fair' && trustTier(99, 4) === 'building');
check('Bayesian average pulls one 5★ review toward the mean', computeTrustScore({ reviews: mk(1, 5), verificationLevel: 'phone', platformMean: 4 }).bayesianRating === 4.17);
const strong = computeTrustScore({ reviews: mk(50, 5, { visited: true, ownerReply: { createdAt: new Date() } }), verificationLevel: 'registered', platformMean: 4, getAuthor: () => ({ emailVerified: true, createdAt: new Date(Date.now() - 400 * 86400000), helpfulVotesReceived: 30 }) });
const weak = computeTrustScore({ reviews: mk(12, 2), verificationLevel: 'phone', platformMean: 4 });
check('strong record → highly trusted; weak → fair', strong.tier === 'high' && weak.tier === 'fair', `${strong.score} vs ${weak.score}`);
check('breakdown points add up to the score', Math.abs(Object.values(strong.breakdown).reduce((a, b) => a + b.points, 0) - strong.score) <= 1);

// --- Cleanup: remove test data, unlink the seeded owner, restore seeded scores ---
const testUsers = (await User.find({ email: /@rv-smoke\.test$/ }, { _id: 1 }).lean()).map((u) => u._id);
const testReviews = (await Review.find({ authorId: { $in: testUsers } }, { _id: 1 }).lean()).map((x) => x._id);
await Promise.all([Review.deleteMany({ _id: { $in: testReviews } }), ReviewVote.deleteMany({ $or: [{ userId: { $in: testUsers } }, { reviewId: { $in: testReviews } }] }), Report.deleteMany({ targetId: { $in: [...testReviews, reviewA && reviewA.id].filter(Boolean) } })]);
await User.deleteMany({ _id: { $in: testUsers } });
await User.updateOne({ email: 'owner.kasi-threads-tailoring@seed.blacklink.test' }, { $set: { clerkId: null } });
for (const id of touched) await recalcBusiness(id);
server.close();
await disconnectDb();
process.stdout.write(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}\n`);
process.exit(failures ? 1 : 0);
