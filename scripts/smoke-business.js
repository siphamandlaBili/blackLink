// Phase 3 smoke test (NODE_ENV=test, seeded database): discovery, profile, onboarding,
// engagement, landing endpoints and SAST opening hours.
//   NODE_ENV=test npm run smoke:business
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Business, Follow, Save, User, Vouch } from '../src/models/index.js';
import { registerTestClerkUser } from '../src/services/clerk.js';
import { openStatus, weeklyRanges } from '../src/services/openNow.js';

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
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { 'X-Test-Clerk-Id': as } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};
const PRIVATE = /cipcNumber"?:\s*"\d|ownerId|openRanges|nameLower|suspendedReason|textHash|clerkId|@seed\.blacklink/;

// Test accounts
const people = {
  owner: { clerkId: 'user_biz_owner', email: 'owner@biz-smoke.test', emailVerified: true, firstName: 'Joy', lastName: 'Mahlangu' },
  other: { clerkId: 'user_biz_other', email: 'other@biz-smoke.test', emailVerified: true, firstName: 'Sam', lastName: 'Other' },
  v1: { clerkId: 'user_biz_v1', email: 'v1@biz-smoke.test', emailVerified: true, firstName: 'Vee', lastName: 'One' },
  v2: { clerkId: 'user_biz_v2', email: 'v2@biz-smoke.test', emailVerified: true, firstName: 'Vee', lastName: 'Two' },
  v3: { clerkId: 'user_biz_v3', email: 'v3@biz-smoke.test', emailVerified: true, firstName: 'Vee', lastName: 'Three' },
  unverified: { clerkId: 'user_biz_unv', email: 'unv@biz-smoke.test', emailVerified: false, firstName: 'Una', lastName: 'Verified' },
};
Object.values(people).forEach((p) => registerTestClerkUser({ avatarUrl: null, ...p }));
const cleanup = async () => {
  const ids = (await User.find({ email: /@biz-smoke\.test$/ }, { _id: 1 }).lean()).map((u) => u._id);
  const mine = (await Business.find({ ownerId: { $in: ids } }, { _id: 1 }).lean()).map((b) => b._id);
  await Promise.all([Business.deleteMany({ _id: { $in: mine } }), Follow.deleteMany({ userId: { $in: ids } }), Save.deleteMany({ userId: { $in: ids } }), Vouch.deleteMany({ userId: { $in: ids } })]);
  await User.deleteMany({ _id: { $in: ids } });
};
await cleanup();

// --- Directory ---
let r = await api('/businesses?limit=20');
check('list: first page of 20 with a cursor', r.status === 200 && r.body.data.length === 20 && r.body.meta.nextCursor);
const seen = new Set(r.body.data.map((b) => b.id));
let cursor = r.body.meta.nextCursor;
let prev = r.body.data.at(-1).rating;
let ordered = r.body.data.every((b, i, a) => i === 0 || a[i - 1].rating >= b.rating);
while (cursor) {
  r = await api(`/businesses?limit=20&cursor=${cursor}`);
  r.body.data.forEach((b) => seen.add(b.id));
  ordered = ordered && r.body.data.every((b) => b.rating <= prev) && r.body.data.every((b, i, a) => i === 0 || a[i - 1].rating >= b.rating);
  prev = r.body.data.at(-1)?.rating ?? prev;
  cursor = r.body.meta.nextCursor;
}
check('list: paging covers all 44 with no repeats, best rated first', seen.size === 44 && ordered, `${seen.size} unique`);
for (const [sort, key] of [['trusted', (b) => b.trust.score ?? -1], ['popular', null], ['newest', (b) => new Date(b.publishedAt).getTime()]]) {
  r = await api(`/businesses?sort=${sort}&limit=50`);
  const ok = r.status === 200 && (!key || r.body.data.every((b, i, a) => i === 0 || key(a[i - 1]) >= key(b) || (sort === 'trusted' && a[i - 1].trust.score === null)));
  check(`list: sort=${sort}`, ok);
}
r = await api('/businesses?q=braids');
check('search: "braids" finds Dube Braids Palace', r.body.data[0]?.slug === 'dube-braids-palace', r.body.data.map((b) => b.slug).join(','));
r = await api('/businesses?q=sak');
check('search: short query "sak" uses the name prefix', r.body.data.length === 1 && r.body.data[0].slug === 'sakhumzi-corner-grill');
r = await api('/businesses?q=zzzzqq');
check('search: no match → empty list', r.status === 200 && r.body.data.length === 0);

const filterCases = [
  ['category=food,hair', (b) => ['food', 'hair'].includes(b.category)],
  ['township=dube', (b) => b.township === 'dube'],
  ['minRating=4.5', (b) => b.rating >= 4.5],
  ['minTrust=70', (b) => b.trust.score >= 70],
  ['price=1', (b) => b.priceLevel === 1],
  ['verification=registered', (b) => b.verificationLevel === 'registered'],
  ['hasOffers=true', (b) => b.hasActiveOffer],
  ['backupPower=true', (b) => b.backupPower],
  ['newThisMonth=true', (b) => b.isNew],
  ['openNow=true', (b) => b.openStatus.status !== 'closed'],
];
for (const [qs, test] of filterCases) {
  r = await api(`/businesses?${qs}&limit=50`);
  check(`filter: ${qs}`, r.status === 200 && r.body.data.every(test), `${r.body.data?.length} results`);
}
for (const [qs, label] of [['category=bogus', 'unknown category'], ['limit=100', 'limit over 50'], ['colour=red', 'unknown parameter'], ['cursor=%%%', 'garbage cursor'], ['minRating[$gt]=1', '"$" operator in query']]) {
  r = await api(`/businesses?${qs}`);
  check(`rejects ${label} → 400`, r.status === 400, r.body?.error?.code);
}

// --- Nearby ---
r = await api('/businesses/nearby?lat=-26.2386&lng=27.9087&radiusKm=2');
check('nearby: within radius, with distance and reasons', r.status === 200 && r.body.data.length > 0 && r.body.data.every((b) => b.distanceM <= 2000 && b.reasons[0].code === 'distance'));
check('nearby: best match is ranked by score', r.body.data.every((b, i, a) => i === 0 || a[i - 1].matchScore >= b.matchScore));
r = await api('/businesses/nearby?lat=-26.2386&lng=27.9087&radiusKm=20&sort=distance');
check('nearby: sort=distance ascending, max 50', r.body.data.length <= 50 && r.body.data.every((b, i, a) => i === 0 || a[i - 1].distanceM <= b.distanceM));
r = await api('/businesses/nearby?lat=-26.2386&lng=27.9087&radiusKm=20&category=food');
check('nearby: filters apply', r.body.data.length > 0 && r.body.data.every((b) => b.category === 'food'));
r = await api('/businesses/nearby?lng=27.9');
check('nearby: missing lat → 400', r.status === 400);

// --- Profile and privacy ---
r = await api('/businesses/sakhumzi-corner-grill');
check('profile: public view with trust breakdown and offers', r.status === 200 && r.body.data.trust.breakdown.ratingQuality && Array.isArray(r.body.data.offers) && r.body.data.offers.length === 1);
check('profile: no private or internal fields', !PRIVATE.test(JSON.stringify(r.body)));
const lists = [await api('/businesses?limit=50'), await api('/businesses/nearby?lat=-26.25&lng=27.87&radiusKm=20'), await api('/public/activity'), await api('/public/featured')];
check('lists and landing data never leak private fields', lists.every((x) => !PRIVATE.test(JSON.stringify(x.body))));
r = await api('/businesses/does-not-exist');
check('profile: unknown slug → 404', r.status === 404);

// --- Onboarding ---
r = await api('/businesses', { as: 'user_biz_owner', method: 'POST', body: {} });
const draftId = r.body?.data?.id;
check('create: empty draft', r.status === 201 && r.body.data.status === 'draft');
check('create: customer became an owner', (await User.findOne({ clerkId: 'user_biz_owner' }).lean()).role === 'owner');
r = await api(`/businesses/${draftId}/publish`, { as: 'user_biz_owner', method: 'POST' });
check('publish: incomplete draft → 422 with missing fields', r.status === 422 && ['name', 'category', 'location', 'whatsapp', 'hours'].every((f) => r.body.error.details.missing.includes(f)));
r = await api(`/businesses/${draftId}`, { as: 'user_biz_owner', method: 'PATCH', body: { location: { lat: -33.92, lng: 18.42 } } });
check('patch: pin outside Soweto → 422', r.status === 422 && r.body.error.code === 'OUTSIDE_SOWETO');
for (const [label, body] of [['stats', { stats: { rating: 5 } }], ['status', { status: 'published' }], ['trust', { trust: { score: 100 } }], ['verification level', { verificationLevel: 'registered' }], ['ownerId', { ownerId: '64b000000000000000000000' }]]) {
  r = await api(`/businesses/${draftId}`, { as: 'user_biz_owner', method: 'PATCH', body });
  check(`patch: can't set ${label} → 400`, r.status === 400);
}
r = await api(`/businesses/${draftId}`, { as: 'user_biz_other', method: 'PATCH', body: { name: 'Hijack' } });
check("patch: someone else's business → 403", r.status === 403);
const steps = [
  { onboardingStep: 2, name: 'Mama Joy Kota Palace', category: 'food', description: 'Loaded kotas and chips.', tags: ['Kota'] },
  { onboardingStep: 3, location: { lat: -26.2361, lng: 27.8912 }, township: 'dube', howToFind: 'Next to the Dube taxi rank' },
  { onboardingStep: 4, hours: { fri: [{ open: '18:00', close: '02:00' }], sat: [{ open: '10:00', close: '22:00' }] }, whatsapp: '071 234 5678', priceLevel: 1 },
];
for (const body of steps) r = await api(`/businesses/${draftId}`, { as: 'user_biz_owner', method: 'PATCH', body });
check('patch: wizard steps saved, WhatsApp normalised', r.status === 200 && r.body.data.whatsapp === '27712345678' && r.body.data.onboardingStep === 4);
const draftSlug = r.body.data.slug;
r = await api(`/businesses/${draftSlug}`);
check('draft is hidden from the public', r.status === 404);
r = await api(`/businesses/${draftId}/publish`, { as: 'user_biz_owner', method: 'POST' });
check('publish: goes live with a clean slug', r.status === 200 && r.body.data.status === 'published' && r.body.data.slug === 'mama-joy-kota-palace');
r = await api('/businesses/mama-joy-kota-palace');
check('published listing is public', r.status === 200 && r.body.data.name === 'Mama Joy Kota Palace');
r = await api('/businesses/mine', { as: 'user_biz_owner' });
check('mine: owner sees their listing', r.status === 200 && r.body.data.some((b) => b.id === draftId));

// --- Engagement ---
const target = await Business.findOne({ slug: 'orlando-sound-studio' }).lean();
const before = target.stats.followerCount;
await Promise.all(Array.from({ length: 5 }, () => api(`/businesses/${target._id}/follow`, { as: 'user_biz_other', method: 'POST' })));
let after = (await Business.findById(target._id).lean()).stats.followerCount;
check('follow: five simultaneous taps count once', after === before + 1, `${before} → ${after}`);
await api(`/businesses/${target._id}/follow`, { as: 'user_biz_other', method: 'DELETE' });
r = await api(`/businesses/${target._id}/follow`, { as: 'user_biz_other', method: 'DELETE' });
after = (await Business.findById(target._id).lean()).stats.followerCount;
check('unfollow twice: back to the original count', after === before && r.body.data.active === false);
await api(`/businesses/${target._id}/follow`, { as: 'user_biz_other', method: 'POST' });
const flagged = await api('/businesses/orlando-sound-studio', { as: 'user_biz_other' });
check('follow: shown in viewer flags', flagged.body.data.viewer.following === true && !('saved' in flagged.body.data.viewer));
r = await api(`/businesses/${target._id}/save`, { as: 'user_biz_other', method: 'POST' });
check('save endpoint is gone → 404', r.status === 404);
await api(`/businesses/${target._id}/follow`, { as: 'user_biz_other', method: 'DELETE' });
r = await api(`/businesses/${target._id}/follow`, { method: 'POST' });
check('follow signed out → 401', r.status === 401);

r = await api(`/businesses/${draftId}/vouch`, { as: 'user_biz_owner', method: 'POST' });
check("vouch: owner can't vouch for their own business → 403", r.status === 403);
r = await api(`/businesses/${draftId}/vouch`, { as: 'user_biz_unv', method: 'POST' });
check('vouch: unverified email → 403', r.status === 403 && r.body.error.code === 'EMAIL_NOT_VERIFIED');
for (const v of ['user_biz_v1', 'user_biz_v2', 'user_biz_v3']) r = await api(`/businesses/${draftId}/vouch`, { as: v, method: 'POST' });
check('vouch: three vouches upgrade to "vouched"', r.body.data.verificationLevel === 'vouched' && r.body.data.upgraded === true);
r = await api(`/businesses/${draftId}/vouch`, { as: 'user_biz_v1', method: 'POST' });
check('vouch: twice → 409', r.status === 409);

// --- Landing endpoints ---
r = await api('/public/stats');
check('public/stats', r.status === 200 && r.body.data.businesses >= 44 && r.body.data.reviews >= 783 && 'eventsThisMonth' in r.body.data && r.headers.get('cache-control')?.includes('max-age'));
r = await api('/public/featured');
check('public/featured: three with photos', r.body.data.length === 3 && r.body.data.every((b) => b.coverUrl));
r = await api('/public/trending');
check('public/trending: at least 8', r.body.data.length >= 8);
r = await api('/public/activity');
check('public/activity: 20 items, display names only', r.body.data.length === 20 && r.body.data.filter((a) => a.type === 'review').every((a) => /^\S+( \S\.)?$|^Former member$/.test(a.displayName)));
r = await api('/public/spotlight');
check('public/spotlight: Gogo Catering', r.body.data?.business?.slug === 'gogo-catering' && r.body.data.quote);
r = await api('/public/categories');
check('public/categories: all 15 with counts', r.body.data.length === 15 && r.body.data.reduce((a, c) => a + c.count, 0) >= 44);

// --- Opening hours in SAST, including overnight spans ---
const sast = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h - 2, mi)); // SAST = UTC+2
const late = { fri: [{ open: '18:00', close: '02:00' }] }; // 2026-10-02 is a Friday
check('hours: Friday 17:59 → closed, opens 18:00', openStatus(late, sast(2026, 10, 2, 17, 59)).status === 'closed' && openStatus(late, sast(2026, 10, 2, 17, 59)).opensAt === '18:00');
check('hours: Friday 22:00 → open until 02:00', openStatus(late, sast(2026, 10, 2, 22, 0)).status === 'open' && openStatus(late, sast(2026, 10, 2, 22, 0)).closesAt === '02:00');
check('hours: Saturday 01:30 → closing soon (past midnight)', openStatus(late, sast(2026, 10, 3, 1, 30)).status === 'closingSoon');
check('hours: Saturday 02:00 → closed', openStatus(late, sast(2026, 10, 3, 2, 0)).status === 'closed');
const sunday = { sun: [{ open: '22:00', close: '03:00' }] };
check('hours: Sunday night span wraps into Monday 01:00', openStatus(sunday, sast(2026, 10, 5, 1, 0)).status === 'open' && weeklyRanges(sunday).length === 2);
check('hours: time zone is SAST, not the server clock', openStatus({ mon: [{ open: '08:00', close: '09:00' }] }, new Date(Date.UTC(2026, 9, 5, 6, 30))).status === 'closingSoon');

await cleanup();
server.close();
await disconnectDb();
process.stdout.write(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}\n`);
process.exit(failures ? 1 : 0);
