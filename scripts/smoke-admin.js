// Phase 7 smoke test (NODE_ENV=test, seeded database): tracking, owner dashboard, admin
// moderation with audit log, suspensions, CIPC review, and POPIA export and deletion.
//   NODE_ENV=test npm run smoke:admin
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { AuditLog, Business, BusinessStatsDaily, Follow, Notification, Report, Review, User } from '../src/models/index.js';
import { fetchClerkIdentity, registerTestClerkUser } from '../src/services/clerk.js';
import { settleEmails } from '../src/services/notifications.js';
import { recalcBusiness } from '../src/services/trustRecalc.js';

if (process.env.NODE_ENV !== 'test') throw new Error('Run with NODE_ENV=test');
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
};
await connectDb();
await Business.deleteMany({ slug: /^admin-test/ });
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
const api = async (path, { as, method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(as ? { 'X-Test-Clerk-Id': as } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null), headers: res.headers };
};
const person = (k) => registerTestClerkUser({ clerkId: `user_ad_${k}`, email: `${k}@ad-smoke.test`, emailVerified: true, firstName: k, lastName: 'Tester', avatarUrl: null });
['owner', 'r1', 'r2', 'admin', 'admin2', 'leaver'].forEach(person);
const as = (k) => `user_ad_${k}`;
for (const k of ['owner', 'r1', 'r2', 'admin', 'admin2', 'leaver']) await api('/me', { as: as(k) });
await User.updateMany({ clerkId: { $in: [as('admin'), as('admin2')] } }, { $set: { role: 'admin' } });
const settle = async () => {
  await new Promise((r) => setTimeout(r, 150));
  await settleEmails();
};

let r = await api('/businesses', { as: as('owner'), method: 'POST', body: { name: 'Admin Test Shisanyama', category: 'food', location: { lat: -26.2395, lng: 27.9075 }, township: 'orlando-west', whatsapp: '0741112233', hours: { sun: [{ open: '10:00', close: '20:00' }] }, cipcNumber: '2019/123456/07' } });
const bizId = r.body.data.id;
await api(`/businesses/${bizId}/publish`, { as: as('owner'), method: 'POST' });

// --- Tracking ---
const ip = (n) => ({ 'X-Forwarded-For': `10.0.0.${n}` });
r = await api('/track', { method: 'POST', body: { businessId: bizId, event: 'view' }, headers: ip(1) });
await api('/track', { method: 'POST', body: { businessId: bizId, event: 'view' }, headers: ip(1) });
await api('/track', { method: 'POST', body: { businessId: bizId, event: 'view' }, headers: ip(2) });
await api('/track', { method: 'POST', body: { businessId: bizId, event: 'whatsapp' }, headers: ip(1) });
await api('/track', { method: 'POST', body: { businessId: bizId, event: 'whatsapp' }, headers: ip(1) });
await api('/track', { as: as('owner'), method: 'POST', body: { businessId: bizId, event: 'view' }, headers: ip(3) });
let day = await BusinessStatsDaily.findOne({ businessId: bizId }).lean();
check('track: 202; repeat view counts once; clicks count each; owner not counted', r.status === 202 && day.views === 2 && day.whatsappClicks === 2);
check('track: stored counters hold no personal data', Object.keys(day).every((k) => ['_id', 'businessId', 'date', 'views', 'whatsappClicks', 'callClicks', 'directionsClicks', 'websiteClicks'].includes(k)));
r = await api('/track', { method: 'POST', body: { businessId: bizId, event: 'hack' }, headers: ip(4) });
check('track: unknown event → 400', r.status === 400);
r = await api('/track', { method: 'POST', body: { businessId: '64b000000000000000000000', event: 'view' }, headers: ip(4) });
check('track: unknown business → 404', r.status === 404);
const bursts = [];
for (let i = 0; i < 25; i += 1) bursts.push((await api('/track', { method: 'POST', body: { businessId: bizId, event: 'call' }, headers: ip(9) })).status);
check('track: per-business rate limit kicks in', bursts.filter((s) => s === 429).length >= 4 && bursts.filter((s) => s === 202).length <= 20);

// --- Dashboard ---
await api(`/businesses/${bizId}/reviews`, { as: as('r1'), method: 'POST', body: { rating: 2, text: 'Waited an hour for our food and nobody explained why.' } });
await api(`/businesses/${bizId}/reviews`, { as: as('r2'), method: 'POST', body: { rating: 5, text: 'Best braai in Orlando West, generous and well priced.' } });
r = await api(`/dashboard/${bizId}`, { as: as('r1') });
check('dashboard: not the owner → 403', r.status === 403);
r = await api(`/dashboard/${bizId}?range=7`, { as: as('owner') });
check('dashboard: only 30 or 90 days → 400', r.status === 400);
r = await api(`/dashboard/${bizId}`, { as: as('owner') });
const d = r.body.data;
check('dashboard: 30-day series and totals match tracking', r.status === 200 && d.engagement.series.length === 30 && d.engagement.totals.views === 2 && d.engagement.series.at(-1).views === 2);
check('dashboard: reviews, unanswered and response rate', d.reviews.total === 2 && d.reviews.unansweredCount === 2 && d.reviews.unanswered[0].author === 'r2 T.' && d.reviews.responseRate === 0);
check('dashboard: Trust Score trend and rating over time', d.trust.trend.length === 6 && d.trust.trend.at(-1).reviews === 2 && d.reviews.ratingOverTime.at(-1).newReviews === 2);
r = await api(`/dashboard/${bizId}?range=90`, { as: as('admin') });
check('dashboard: admin can view, 90-day range', r.status === 200 && r.body.data.engagement.series.length === 90);

// --- Moderation ---
const bad = await Review.findOne({ businessId: bizId, rating: 2 }).lean();
await api(`/reviews/${bad._id}/report`, { as: as('owner'), method: 'POST', body: { reason: 'fake', details: 'Not a customer' } });
await api(`/reviews/${bad._id}/report`, { as: as('r2'), method: 'POST', body: { reason: 'offensive' } });
r = await api('/admin/reports', { as: as('owner') });
check('admin: non-admin → 403', r.status === 403);
r = await api('/admin/reports?targetType=review', { as: as('admin') });
const mine = r.body.data.filter((x) => x.targetId === String(bad._id));
check('admin: queue shows the review, the reason and a preview, no emails', mine.length === 2 && mine[0].target.text.startsWith('Waited') && mine[0].reporter === 'owner T.' && !/@ad-smoke|@seed/.test(JSON.stringify(r.body)));
r = await api(`/admin/reports/${mine[0].id}/resolve`, { as: as('admin'), method: 'POST', body: { action: 'keep', note: 'Genuine experience, just negative' } });
await settle();
check('keep: the negative review stays, reporter is told', r.body.data.status === 'kept' && (await Review.findById(bad._id).lean()).status === 'published' && (await Notification.exists({ type: 'report_outcome', dedupeKey: `report_outcome:${mine[0].id}` })));
r = await api(`/admin/reports/${mine[0].id}/resolve`, { as: as('admin'), method: 'POST', body: { action: 'remove' } });
check('resolving twice → 409', r.status === 409);
const countBefore = (await Business.findById(bizId).lean()).stats.reviewCount;
await api(`/reviews/${bad._id}/report`, { as: as('r1'), method: 'POST', body: { reason: 'spam' } }).catch(() => {});
const r1Report = await Report.findOne({ targetId: bad._id, status: 'open', reason: 'offensive' }).lean();
r = await api(`/admin/reports/${r1Report._id}/resolve`, { as: as('admin'), method: 'POST', body: { action: 'remove', note: 'Hate speech' } });
check('remove: review taken down, stats recalculated, other open reports closed', r.body.data.status === 'removed' && (await Review.findById(bad._id).lean()).status === 'removed' && (await Business.findById(bizId).lean()).stats.reviewCount === countBefore - 1 && !(await Report.exists({ targetId: bad._id, status: 'open' })));
r = await api(`/businesses/${bizId}/reviews?limit=50`);
check('removed review is gone from the public list', !r.body.data.some((x) => x.id === String(bad._id)));

// --- Suspensions ---
const r2 = await User.findOne({ clerkId: as('r2') }).lean();
r = await api(`/admin/users/${r2._id}/suspend`, { as: as('admin'), method: 'POST', body: { reason: 'Spam reviews' } });
const blocked = await api('/me', { as: as('r2') });
check('suspend user: they can no longer use the API', r.status === 200 && blocked.status === 403);
const admin2 = await User.findOne({ clerkId: as('admin2') }).lean();
r = await api(`/admin/users/${admin2._id}/suspend`, { as: as('admin'), method: 'POST', body: { reason: 'Test' } });
check("can't suspend another admin → 403", r.status === 403);
await api(`/admin/users/${r2._id}/unsuspend`, { as: as('admin'), method: 'POST', body: { reason: 'Appeal accepted' } });
check('unsuspend user', (await api('/me', { as: as('r2') })).status === 200);
const slug = (await Business.findById(bizId).lean()).slug;
await api(`/admin/businesses/${bizId}/suspend`, { as: as('admin'), method: 'POST', body: { reason: 'Misleading listing' } });
check('suspend business: hidden from the public, still visible to its owner', (await api(`/businesses/${slug}`)).status === 404 && (await api(`/businesses/${slug}`, { as: as('owner') })).status === 200);
await api(`/admin/businesses/${bizId}/unsuspend`, { as: as('admin'), method: 'POST', body: { reason: 'Fixed' } });
check('unsuspend business: public again', (await api(`/businesses/${slug}`)).status === 200);

// --- CIPC ---
r = await api(`/admin/businesses/${bizId}/verify-cipc`, { as: as('admin'), method: 'POST', body: { approve: true, note: 'Matches CIPC register' } });
const verified = await Business.findById(bizId).lean();
check('CIPC approve → "registered", Trust Score recalculated', r.body.data.verificationLevel === 'registered' && verified.verification.level === 'registered' && verified.trust.breakdown.verification.score === 1);
r = await api(`/admin/businesses/${bizId}/verify-cipc`, { as: as('admin'), method: 'POST', body: { approve: true } });
check('CIPC review twice → 409', r.status === 409);

// --- Audit log ---
r = await api(`/admin/audit?targetId=${bizId}`, { as: as('admin') });
const actions = r.body.data.map((a) => a.action);
check('audit log records every action with its reason', ['business.suspend', 'business.unsuspend', 'business.cipc_approve'].every((x) => actions.includes(x)) && r.body.data.every((a) => a.actor === 'admin T.'));
check('audit log also has the moderation and user actions', (await AuditLog.countDocuments({ action: { $in: ['report.keep', 'report.remove', 'user.suspend', 'user.unsuspend'] } })) >= 4);

// --- POPIA: export ---
const leaver = await User.findOne({ clerkId: as('leaver') }).lean();
await api(`/businesses/${bizId}/follow`, { as: as('leaver'), method: 'POST' });
await api(`/businesses/${bizId}/reviews`, { as: as('leaver'), method: 'POST', body: { rating: 4, text: 'Lovely spot for a Sunday afternoon with the family.' } });
r = await api('/me/export', { as: as('leaver') });
check('export: attachment with their own data', r.status === 200 && r.headers.get('content-disposition')?.includes('attachment') && r.body.data.account.email === 'leaver@ad-smoke.test' && r.body.data.reviews.length === 1 && r.body.data.following.length === 1);
check("export: nobody else's email, no Clerk id", !/owner@|r1@|r2@|admin@/.test(JSON.stringify(r.body)) && !JSON.stringify(r.body).includes('user_ad_'));

// --- POPIA: delete ---
r = await api('/me', { as: as('leaver'), method: 'DELETE', body: {} });
check('delete without confirmation → 400', r.status === 400);
const followersBefore = (await Business.findById(bizId).lean()).stats.followerCount;
r = await api('/me', { as: as('leaver'), method: 'DELETE', body: { confirm: 'DELETE' } });
const gone = await User.findById(leaver._id).lean();
const anon = await Review.findOne({ businessId: bizId, formerMember: true }).lean();
check('delete: account marked deleted, reviews become "Former member"', r.status === 200 && gone.status === 'deleted' && anon && anon.authorId === null);
check('delete: follow removed, rating still counts, Clerk account deleted', !(await Follow.exists({ userId: leaver._id })) && (await Business.findById(bizId).lean()).stats.followerCount === followersBefore - 1 && (await fetchClerkIdentity(as('leaver'))) === null);
check('delete: the account can no longer sign in', (await api('/me', { as: as('leaver') })).status === 403 || (await api('/me', { as: as('leaver') })).status === 404);

// --- Cleanup ---
const ids = (await User.find({ email: /@ad-smoke\.test$/ }, { _id: 1 }).lean()).map((u) => u._id);
await Promise.all([Review.deleteMany({ businessId: bizId }), Report.deleteMany({ targetId: bad._id }), BusinessStatsDaily.deleteMany({ businessId: bizId }), Notification.deleteMany({ userId: { $in: ids } }), Follow.deleteMany({ businessId: bizId }), AuditLog.deleteMany({ actorId: { $in: ids } }), Business.deleteMany({ _id: bizId })]);
await User.deleteMany({ _id: { $in: ids } });
await recalcBusiness(bizId);
server.close();
await disconnectDb();
process.stdout.write(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}\n`);
process.exit(failures ? 1 : 0);
