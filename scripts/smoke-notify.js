// Phase 6 smoke test (NODE_ENV=test, seeded database): notifications, email rules and
// retries, unsubscribe, the notifications inbox, and the five scheduled jobs.
//   NODE_ENV=test npm run smoke:notify
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { Business, Event, Follow, JobRun, Notification, Offer, Review, Rsvp, User } from '../src/models/index.js';
import { registerTestClerkUser } from '../src/services/clerk.js';
import { failNextSends, testOutbox } from '../src/services/email.js';
import { settleEmails } from '../src/services/notifications.js';
import { recalcBusiness } from '../src/services/trustRecalc.js';

if (process.env.NODE_ENV !== 'test') throw new Error('Run with NODE_ENV=test');
let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
};
await connectDb();
await Promise.all([Business.deleteMany({ slug: /^notify-test/ }), JobRun.deleteMany({})]);
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}/api`;
const api = async (path, { as, method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(as ? { 'X-Test-Clerk-Id': as } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
};
const job = (name, qs = '') => api(`/jobs/${name}${qs}`, { method: 'POST', headers: { 'X-Job-Secret': env.JOB_SECRET } });
const person = (k) => registerTestClerkUser({ clerkId: `user_nt_${k}`, email: `${k}@nt-smoke.test`, emailVerified: true, firstName: k[0].toUpperCase() + k.slice(1), lastName: 'Tester', avatarUrl: null });
['owner', 'rev', 'rev2', 'digest', 'gone', 'recent'].forEach(person);
const as = (k) => `user_nt_${k}`;
const mail = (to, subject) => testOutbox.filter((m) => m.to === to && (!subject || m.subject.includes(subject)));
const settle = async () => {
  await new Promise((r) => setTimeout(r, 150)); // listeners start on setImmediate
  await settleEmails();
};

// --- Welcome ---
await api('/me', { as: as('owner') });
await settle();
const welcome = mail('owner@nt-smoke.test', 'Welcome');
check('new account → welcome notification and email', welcome.length === 1 && (await Notification.exists({ type: 'welcome', dedupeKey: /welcome:/ })));
check('email: brand layout, unsubscribe link and one-click header, no gradients', welcome[0].html.includes('/unsubscribe?token=') && welcome[0].headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click' && !/gradient/i.test(welcome[0].html) && /sawubona/i.test(welcome[0].text));
await api('/me', { as: as('owner') });
await settle();
check('second request → no second welcome', mail('owner@nt-smoke.test', 'Welcome').length === 1);
for (const k of ['rev', 'rev2', 'digest', 'gone', 'recent']) await api('/me', { as: as(k) });

// --- Business published → owner ---
let r = await api('/businesses', { as: as('owner'), method: 'POST', body: { name: 'Notify Test Kitchen', category: 'food', location: { lat: -26.2385, lng: 27.9087 }, township: 'orlando-west', whatsapp: '0731112233', hours: { sat: [{ open: '09:00', close: '17:00' }] } } });
const bizId = r.body.data.id;
await api(`/businesses/${bizId}/publish`, { as: as('owner'), method: 'POST' });
await api(`/businesses/${bizId}/publish`, { as: as('owner'), method: 'POST' });
await settle();
check('publish → one "is live" email, even if published twice', mail('owner@nt-smoke.test', 'is live').length === 1);

// --- New review → owner; owner reply → reviewer ---
r = await api(`/businesses/${bizId}/reviews`, { as: as('rev'), method: 'POST', body: { rating: 4, text: 'Really tasty food and the staff were friendly and quick.' } });
const reviewId = r.body.data.id;
await settle();
const reviewMail = mail('owner@nt-smoke.test', 'New 4★ review');
check('new review → owner notified by email with the review text', reviewMail.length === 1 && reviewMail[0].html.includes('Really tasty food') && reviewMail[0].html.includes(`review-${reviewId}`));
await api(`/reviews/${reviewId}/reply`, { as: as('owner'), method: 'PUT', body: { text: 'Thank you, come again!' } });
await api(`/reviews/${reviewId}/reply`, { as: as('owner'), method: 'PUT', body: { text: 'Thank you, come again soon!' } });
await settle();
check('owner reply → reviewer emailed once (editing the reply doesn’t re-send)', mail('rev@nt-smoke.test', 'replied').length === 1);

// Preferences
await api('/me/preferences', { as: as('owner'), method: 'PATCH', body: { notifications: { newReview: false } } });
const before = testOutbox.length;
r = await api(`/businesses/${bizId}/reviews`, { as: as('rev2'), method: 'POST', body: { rating: 5, text: 'Best kota in Orlando West, generous portions every time.' } });
await settle();
const n2 = await Notification.findOne({ dedupeKey: `new_review:${r.body.data.id}` }).lean();
check('email preference off → in-app notification only', testOutbox.length === before && n2?.emailStatus === 'skipped');

// Seeded addresses are never emailed
registerTestClerkUser({ clerkId: 'user_nt_seedowner', email: 'owner.gogo-catering@seed.blacklink.test', emailVerified: true, firstName: 'Thandi', lastName: 'Mabena', avatarUrl: null });
await api('/me', { as: 'user_nt_seedowner' });
const gogo = await Business.findOne({ slug: 'gogo-catering' }).lean();
r = await api(`/businesses/${gogo._id}/reviews`, { as: as('digest'), method: 'POST', body: { rating: 5, text: 'Catered our family day, everyone asked who made the food.' } });
await settle();
const n3 = await Notification.findOne({ dedupeKey: `new_review:${r.body.data.id}` }).lean();
check('seeded demo address → never emailed', n3?.emailStatus === 'skipped' && !testOutbox.some((m) => m.to.endsWith('@seed.blacklink.test')));

// Failures and retry
await api('/me/preferences', { as: as('owner'), method: 'PATCH', body: { notifications: { newReview: true } } });
failNextSends(1);
r = await api(`/businesses/${bizId}/reviews`, { as: as('gone'), method: 'POST', body: { rating: 3, text: 'Decent enough, a bit of a wait on a Saturday afternoon.' } });
await settle();
let n4 = await Notification.findOne({ dedupeKey: `new_review:${r.body.data.id}` }).select('+emailError').lean();
check('one failed send → retried and sent', r.status === 201 && n4.emailStatus === 'sent' && n4.emailAttempts === 2);
failNextSends(2);
r = await api(`/businesses/${bizId}/reviews`, { as: as('recent'), method: 'POST', body: { rating: 4, text: 'Good value and the owner was very welcoming to us.' } });
await settle();
n4 = await Notification.findOne({ dedupeKey: `new_review:${r.body.data.id}` }).lean();
check('two failures → "failed", and the API response still succeeded', r.status === 201 && n4.emailStatus === 'failed');

// --- Inbox ---
r = await api('/me/notifications', { as: as('owner') });
check('inbox lists own notifications with an unread count', r.status === 200 && r.body.data.length >= 5 && r.body.meta.unreadCount === r.body.data.length);
const first = r.body.data[0].id;
r = await api(`/me/notifications/${first}/read`, { as: as('rev'), method: 'PATCH' });
check("marking someone else's notification → 404", r.status === 404);
r = await api(`/me/notifications/${first}/read`, { as: as('owner'), method: 'PATCH' });
check('mark one as read', r.body.data.read === true);
r = await api('/me/notifications/read-all', { as: as('owner'), method: 'POST' });
const after = await api('/me/notifications?unread=true', { as: as('owner') });
check('mark all as read', r.status === 200 && after.body.meta.unreadCount === 0 && after.body.data.length === 0);

// --- Unsubscribe ---
const token = new URL(reviewMail[0].html.match(/href="([^"]*\/unsubscribe\?token=[^"]+)"/)[1].replace(/&amp;/g, '&')).searchParams.get('token');
r = await api(`/unsubscribe?token=${token}`);
const ownerDoc = await User.findOne({ clerkId: as('owner') }).lean();
check('unsubscribe link turns that email type off', r.status === 200 && ownerDoc.preferences.notifications.newReview === false && String(r.body).includes('unsubscribed'));
r = await api(`/unsubscribe?token=${token}`, { method: 'POST' });
check('one-click POST works too', r.status === 200 && r.body.data.unsubscribed === 'newReview');
r = await api(`/unsubscribe?token=${Buffer.from(`${ownerDoc._id}.weeklyDigest.forged`).toString('base64url')}`, { method: 'POST' });
check('forged token → 400', r.status === 400);

// --- Jobs ---
r = await api('/jobs/offer-expiry', { method: 'POST' });
check('job without secret → 401', r.status === 401);
r = await api('/jobs/offer-expiry', { method: 'POST', headers: { 'X-Job-Secret': 'x'.repeat(64) } });
check('job with wrong secret → 401', r.status === 401);
r = await job('make-coffee');
check('unknown job → 404', r.status === 404);

await Offer.create({ businessId: bizId, title: 'Ended deal', startsAt: new Date(Date.now() - 5 * 86400000), endsAt: new Date(Date.now() - 60000) });
await Business.updateOne({ _id: bizId }, { $set: { hasActiveOffer: true } });
r = await job('offer-expiry');
check('offer-expiry: ended offer expired, hasActiveOffer cleared', r.body.data.result.expired >= 1 && (await Business.findById(bizId).lean()).hasActiveOffer === false);
r = await job('offer-expiry');
check('offer-expiry: second call in the same hour is skipped', r.body.data.skipped === true);

const event = await Event.create({ hostId: ownerDoc._id, title: 'Notify Test Night Market', slug: 'notify-test-night-market', type: 'market', location: { type: 'Point', coordinates: [27.9087, -26.2385] }, venue: 'Vilakazi Street', township: 'orlando-west', startsAt: new Date(Date.now() + 5 * 3600000), endsAt: new Date(Date.now() + 8 * 3600000), rsvpCount: 2 });
for (const k of ['rev', 'rev2']) await Rsvp.create({ eventId: event._id, userId: (await User.findOne({ clerkId: as(k) }).lean())._id });
r = await job('event-reminders');
await settle();
check('event-reminders: everyone going is reminded', r.body.data.result.sent === 2 && mail('rev@nt-smoke.test', 'Reminder').length === 1 && (await Rsvp.countDocuments({ eventId: event._id, reminderSentAt: { $ne: null } })) === 2);
r = await job('event-reminders', '?force=true');
check('event-reminders: re-run sends nothing new', r.body.data.result.sent === 0);

await api('/me/preferences', { as: as('digest'), method: 'PATCH', body: { notifications: { weeklyDigest: true } } });
r = await job('weekly-digest');
await settle();
check('weekly-digest: only opted-in members get it', mail('digest@nt-smoke.test', 'kasi weekly').length === 1 && mail('rev@nt-smoke.test', 'kasi weekly').length === 0);
r = await job('weekly-digest', '?force=true');
await settle();
check('weekly-digest: forced re-run the same week sends no duplicate', mail('digest@nt-smoke.test', 'kasi weekly').length === 1);

const stamp = new Date();
r = await job('trust-refresh');
const stale = await Business.countDocuments({ status: 'published', 'trust.calculatedAt': { $lt: stamp } });
check('trust-refresh: every published business recalculated', r.body.data.result.recalculated >= 44 && stale === 0);

const gone = await User.findOne({ clerkId: as('gone') }).lean();
const recent = await User.findOne({ clerkId: as('recent') }).lean();
await Follow.create({ userId: gone._id, businessId: bizId });
await Business.updateOne({ _id: bizId }, { $inc: { 'stats.followerCount': 1 } });
const followersBefore = (await Business.findById(bizId).lean()).stats.followerCount;
await User.updateOne({ _id: gone._id }, { $set: { status: 'deleted', deletedAt: new Date(Date.now() - 31 * 86400000) } });
await User.updateOne({ _id: recent._id }, { $set: { status: 'deleted', deletedAt: new Date(Date.now() - 5 * 86400000) } });
r = await job('purge-deleted');
const kept = await Review.findOne({ businessId: bizId, formerMember: true }).lean();
check('purge-deleted: 31-day-old deletion purged, review kept as "Former member"', !(await User.exists({ _id: gone._id })) && kept && kept.authorId === null && !(await Follow.exists({ userId: gone._id })) && (await Business.findById(bizId).lean()).stats.followerCount === followersBefore - 1);
check('purge-deleted: 5-day-old deletion kept for now', Boolean(await User.exists({ _id: recent._id })));
r = await api(`/businesses/${bizId}/reviews?limit=50`);
check('anonymised review shows "Former member"', r.body.data.some((x) => x.author.displayName === 'Former member'));

// --- Cleanup ---
const ids = (await User.find({ email: /@nt-smoke\.test$/ }, { _id: 1 }).lean()).map((u) => u._id);
await Promise.all([Review.deleteMany({ $or: [{ businessId: bizId }, { authorId: { $in: ids } }] }), Offer.deleteMany({ businessId: bizId }), Event.deleteMany({ _id: event._id }), Rsvp.deleteMany({ eventId: event._id }), Notification.deleteMany({}), Business.deleteMany({ _id: bizId }), JobRun.deleteMany({})]);
await User.deleteMany({ _id: { $in: ids } });
await User.updateOne({ email: 'owner.gogo-catering@seed.blacklink.test' }, { $set: { clerkId: null } });
await recalcBusiness(gogo._id);
server.close();
await disconnectDb();
process.stdout.write(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}\n`);
process.exit(failures ? 1 : 0);
