// Phase 5 smoke test (NODE_ENV=test, seeded database): signed uploads and media checks,
// posts, reactions, comments, events with RSVP capacity, and offers.
//   NODE_ENV=test npm run smoke:community
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Business, Comment, Event, Offer, Post, Reaction, Review, Rsvp, User } from '../src/models/index.js';
import { registerTestClerkUser } from '../src/services/clerk.js';
import { registerTestUpload, testDestroyed } from '../src/services/cloudinary.js';
import { recalcBusiness } from '../src/services/trustRecalc.js';

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
const person = (k, extra = {}) => registerTestClerkUser({ clerkId: `user_cm_${k}`, email: `${k}@cm-smoke.test`, emailVerified: true, firstName: k, lastName: 'Tester', avatarUrl: null, ...extra });
['owner', 'm1', 'm2', 'm3', 'admin'].forEach((k) => person(k));
person('unv', { emailVerified: false });
const as = (k) => `user_cm_${k}`;
const uid = async (k) => String((await User.findOne({ clerkId: as(k) }).lean())._id);
const PRIVATE = /@cm-smoke|@seed\.blacklink|clerkId|textHash|hostId|authorId|cipcNumber/;
const soon = (days, hours = 0) => new Date(Date.now() + days * 86400000 + hours * 3600000).toISOString();

// Clear anything left behind by an earlier run that stopped half-way.
await Business.deleteMany({ slug: /^media-test/ });
await Event.deleteMany({ slug: /^media-test/ });

// Test users exist after their first request (created on the fly, as with a real Clerk token).
for (const k of ['owner', 'm1', 'm2', 'm3', 'admin', 'unv']) await api('/me', { as: as(k) });

// A published business for the owner.
let r = await api('/businesses', { as: as('owner'), method: 'POST', body: { name: 'Media Test Braai', category: 'food', location: { lat: -26.2385, lng: 27.9087 }, township: 'orlando-west', whatsapp: '0721112233', hours: { sat: [{ open: '10:00', close: '20:00' }] } } });
const bizId = r.body.data.id;
await api(`/businesses/${bizId}/publish`, { as: as('owner'), method: 'POST' });
const ownerId = await uid('owner');

// --- Uploads ---
r = await api('/uploads/sign', { method: 'POST', body: { purpose: 'business-cover' } });
check('sign upload signed out → 401', r.status === 401);
r = await api('/uploads/sign', { as: as('owner'), method: 'POST', body: { purpose: 'selfie' } });
check('unknown purpose → 400', r.status === 400);
r = await api('/uploads/sign', { as: as('owner'), method: 'POST', body: { purpose: 'business-cover' } });
const signed = r.body.data;
check('signed params lock folder, format list and 640px eager', signed.fields.folder === `blacklink/users/${ownerId}` && signed.publicId.startsWith(`blacklink/users/${ownerId}/business-cover-`) && signed.fields.eager === 'c_limit,w_640/f_auto,q_auto' && signed.fields.signature && signed.maxBytes === 5242880);
registerTestUpload(signed.publicId, {});
r = await api(`/businesses/${bizId}`, { as: as('owner'), method: 'PATCH', body: { cover: { publicId: signed.publicId } } });
check('cover attached after server-side check, with thumbnail', r.status === 200 && r.body.data.coverUrl.includes(signed.publicId) && r.body.data.coverThumbUrl.includes('w_640'));
const m1Id = await uid('m1');
registerTestUpload(`blacklink/users/${m1Id}/business-cover-theirs`, {});
r = await api(`/businesses/${bizId}`, { as: as('owner'), method: 'PATCH', body: { cover: { publicId: `blacklink/users/${m1Id}/business-cover-theirs` } } });
check("someone else's upload → 403 UPLOAD_NOT_YOURS", r.status === 403 && r.body.error.code === 'UPLOAD_NOT_YOURS');
registerTestUpload(`blacklink/users/${ownerId}/huge`, { bytes: 6 * 1024 * 1024 });
r = await api(`/businesses/${bizId}`, { as: as('owner'), method: 'PATCH', body: { logo: { publicId: `blacklink/users/${ownerId}/huge` } } });
check('over 5 MB → 422 and deleted from Cloudinary', r.status === 422 && r.body.error.code === 'UPLOAD_TOO_LARGE' && testDestroyed.includes(`blacklink/users/${ownerId}/huge`));
registerTestUpload(`blacklink/users/${ownerId}/doc`, { resource_type: 'raw', format: 'pdf' });
r = await api(`/businesses/${bizId}`, { as: as('owner'), method: 'PATCH', body: { logo: { publicId: `blacklink/users/${ownerId}/doc` } } });
check('not an image → 422', r.status === 422 && r.body.error.code === 'UPLOAD_NOT_IMAGE');
r = await api(`/businesses/${bizId}`, { as: as('owner'), method: 'PATCH', body: { logo: { publicId: `blacklink/users/${ownerId}/never-uploaded` } } });
check('never uploaded → 422', r.status === 422 && r.body.error.code === 'UPLOAD_NOT_FOUND');
r = await api(`/businesses/${bizId}`, { as: as('owner'), method: 'PATCH', body: { cover: { url: 'https://evil.example/x.jpg' } } });
check('a client-sent URL is rejected → 400', r.status === 400);
registerTestUpload(`blacklink/users/${ownerId}/business-cover-2`, {});
await api(`/businesses/${bizId}`, { as: as('owner'), method: 'PATCH', body: { cover: { publicId: `blacklink/users/${ownerId}/business-cover-2` } } });
check('replacing the cover deletes the old one from Cloudinary', testDestroyed.includes(signed.publicId));
const photoIds = [1, 2].map((i) => `blacklink/users/${m1Id}/review-photo-${i}`);
photoIds.forEach((p) => registerTestUpload(p, {}));
r = await api(`/businesses/${bizId}/reviews`, { as: as('m1'), method: 'POST', body: { rating: 5, text: 'Lovely braai, big portions and the chakalaka is spot on.', photos: photoIds.map((publicId) => ({ publicId })) } });
check('review with 2 photos', r.status === 201 && r.body.data.photos.length === 2 && r.body.data.photos[0].thumbUrl.includes('w_640'));
r = await api(`/businesses/${bizId}/reviews?withPhotos=true`);
check('review list withPhotos filter', r.body.data.length === 1);

// --- Posts ---
r = await api('/posts', { as: as('unv'), method: 'POST', body: { type: 'thread', topic: 'Local collabs', title: 'Anyone?', body: 'Hello' } });
check('post with unverified email → 403', r.status === 403);
r = await api('/posts', { as: as('m1'), method: 'POST', body: { type: 'thread', topic: 'Tips for new owners', title: 'Where do you buy stock?', body: 'Looking for a good wholesaler near Dube.' } });
const thread = r.body.data;
check('member starts a thread', r.status === 201 && thread.type === 'thread' && thread.author.displayName === 'm1 T.');
r = await api('/posts', { as: as('m1'), method: 'POST', body: { type: 'update', businessId: bizId, body: 'Not my business' } });
check("update for someone else's business → 403", r.status === 403);
r = await api('/posts', { as: as('owner'), method: 'POST', body: { type: 'update', businessId: bizId, body: 'Saturday braai is on from 10am.' } });
check('owner posts an update for their business', r.status === 201 && r.body.data.business.id === bizId);
r = await api('/posts', { as: as('owner'), method: 'POST', body: { type: 'thread', topic: 'Local collabs', title: 'Hi', body: 'x', businessId: bizId } });
check('fields from another post type are rejected → 400', r.status === 400);
r = await api('/posts', { as: as('owner'), method: 'POST', body: { type: 'collab', businessId: bizId, lookingFor: 'creative', title: 'DJ wanted for Saturdays', body: 'Looking for a DJ for Saturday braais.' } });
const collab = r.body.data;
check('collab request opens', r.status === 201 && collab.collabStatus === 'open');
r = await api(`/posts/${collab.id}`, { as: as('m1'), method: 'PATCH', body: { collabStatus: 'closed' } });
check("closing someone else's collab → 403", r.status === 403);
r = await api(`/posts/${collab.id}`, { as: as('owner'), method: 'PATCH', body: { collabStatus: 'closed' } });
check('author closes the collab', r.body.data.collabStatus === 'closed');
r = await api(`/posts/${thread.id}`, { as: as('m1'), method: 'PATCH', body: { collabStatus: 'closed' } });
check('collabStatus on a thread → 403', r.status === 403);
const spotlight = { type: 'spotlight', businessId: bizId, title: 'Spotlight: Media Test Braai', body: 'Our pick this week.', spotlight: { from: new Date(Date.now() - 60000).toISOString(), to: soon(7), story: 'Started as a weekend stand and now feeds the whole street every Saturday.', quote: 'Come hungry.' } };
r = await api('/posts', { as: as('m1'), method: 'POST', body: spotlight });
check('spotlight by a non-admin → 403', r.status === 403);
await User.updateOne({ clerkId: as('admin') }, { $set: { role: 'admin' } });
r = await api('/posts', { as: as('admin'), method: 'POST', body: spotlight });
const landing = await api('/public/spotlight');
check('admin publishes a spotlight; landing shows it at once', r.status === 201 && landing.body.data?.business?.id === bizId);
r = await api('/posts?type=thread&topic=Tips%20for%20new%20owners');
check('feed filters by type and topic', r.body.data.length >= 1 && r.body.data.every((p) => p.type === 'thread' && p.topic === 'Tips for new owners'));

// Reactions
await Promise.all(Array.from({ length: 5 }, () => api(`/posts/${thread.id}/reaction`, { as: as('m2'), method: 'PUT', body: { kind: 'fire' } })));
r = await api(`/posts/${thread.id}/reaction`, { as: as('m2'), method: 'PUT', body: { kind: 'love' } });
check('five simultaneous reactions count once; changing kind keeps the count', r.body.data.reactionCount === 1 && r.body.data.reaction === 'love');
r = await api(`/posts/${thread.id}/reaction`, { as: as('m2'), method: 'DELETE' });
check('removing the reaction → 0', r.body.data.reactionCount === 0);

// Comments
await api(`/posts/${thread.id}/comments`, { as: as('m2'), method: 'POST', body: { body: 'Try the Soweto wholesalers on Old Potch Road.' } });
r = await api(`/posts/${thread.id}/comments`, { as: as('m3'), method: 'POST', body: { body: 'Makro in Protea Glen does bulk too.' } });
const m3Comment = r.body.data.id;
r = await api(`/posts/${thread.id}/comments`);
check('comments list oldest first; count updated', r.body.data.length === 2 && r.body.data[0].body.startsWith('Try') && (await Post.findById(thread.id).lean()).commentCount === 2);
r = await api(`/comments/${m3Comment}`, { as: as('m2'), method: 'DELETE' });
check("deleting someone else's comment → 403", r.status === 403);
r = await api(`/comments/${m3Comment}`, { as: as('m1'), method: 'DELETE' });
check('the post author can tidy their thread', r.status === 200 && (await Post.findById(thread.id).lean()).commentCount === 1);
r = await api(`/posts/${collab.id}`, { as: as('owner'), method: 'DELETE' });
check('deleted post is gone from the public', r.status === 200 && (await api(`/posts/${collab.id}`)).status === 404);

// --- Events ---
const ev = { title: 'Media Test Market', type: 'market', description: 'Stalls and music.', location: { lat: -26.2386, lng: 27.9087 }, venue: 'Vilakazi Street', township: 'orlando-west', startsAt: soon(3), endsAt: soon(3, 5), priceCents: 0, capacity: 2, businessId: bizId };
r = await api('/events', { as: as('owner'), method: 'POST', body: { ...ev, startsAt: soon(-1), endsAt: soon(-1, 2) } });
check('event in the past → 422', r.status === 422 && r.body.error.code === 'EVENT_IN_PAST');
r = await api('/events', { as: as('owner'), method: 'POST', body: { ...ev, location: { lat: -33.92, lng: 18.42 } } });
check('event outside Soweto → 422', r.status === 422);
r = await api('/events', { as: as('owner'), method: 'POST', body: { ...ev, endsAt: soon(2) } });
check('end before start → 400', r.status === 400);
r = await api('/events', { as: as('m1'), method: 'POST', body: ev });
check("hosting as someone else's business → 403", r.status === 403);
r = await api('/events', { as: as('owner'), method: 'POST', body: ev });
const event = r.body.data;
check('event created with a slug and price in cents', r.status === 201 && event.slug === 'media-test-market' && event.priceCents === 0 && event.spotsLeft === 2);
const rsvps = await Promise.all(['m1', 'm2', 'm3'].map((k) => api(`/events/${event.id}/rsvp`, { as: as(k), method: 'POST' })));
const full = rsvps.filter((x) => x.status === 409);
check('capacity 2: third RSVP → 409, and its RSVP row is rolled back', full.length === 1 && (await Rsvp.countDocuments({ eventId: event.id })) === 2 && (await Event.findById(event.id).lean()).rsvpCount === 2);
const goingUser = ['m1', 'm2', 'm3'].find((k, i) => rsvps[i].status === 200);
r = await api(`/events/${event.slug}`, { as: as(goingUser) });
check('viewer sees they are going', r.body.data.viewer.going === true && r.body.data.spotsLeft === 0);
r = await api(`/events/${event.id}`, { as: as('owner'), method: 'PATCH', body: { capacity: 1 } });
check('capacity below RSVPs → 422', r.status === 422 && r.body.error.code === 'CAPACITY_TOO_LOW');
await api(`/events/${event.id}/rsvp`, { as: as(goingUser), method: 'DELETE' });
const waiting = ['m1', 'm2', 'm3'][rsvps.findIndex((x) => x.status === 409)];
r = await api(`/events/${event.id}/rsvp`, { as: as(waiting), method: 'POST' });
check('a freed spot can be taken', r.status === 200 && r.body.data.rsvpCount === 2);
r = await api(`/events?type=market&free=true&from=${soon(2)}&to=${soon(4)}`);
check('events list filters and date window', r.body.data.some((e) => e.id === event.id) && r.body.data.every((e) => e.type === 'market' && e.priceCents === 0));
r = await api('/events?limit=50');
check('events soonest first', r.body.data.every((e, i, a) => i === 0 || new Date(a[i - 1].startsAt) <= new Date(e.startsAt)));
r = await api('/events/nearby?lat=-26.2386&lng=27.9087&radiusKm=1');
check('events nearby with distance', r.body.data.some((e) => e.id === event.id && e.distanceM < 50));
r = await api(`/events/${event.id}`, { as: as('m1'), method: 'DELETE' });
check('cancel by a non-host → 403', r.status === 403);
await api(`/events/${event.id}`, { as: as('owner'), method: 'DELETE' });
r = await api(`/events/${event.id}/rsvp`, { as: as('m1'), method: 'POST' });
check('RSVP to a cancelled event → 404', r.status === 404);

// --- Offers ---
r = await api(`/businesses/${bizId}/offers`, { as: as('m1'), method: 'POST', body: { title: 'Free cooldrink' } });
check("offer on someone else's business → 403", r.status === 403);
r = await api(`/businesses/${bizId}/offers`, { as: as('owner'), method: 'POST', body: { title: 'Platter for 2: R 180', priceCents: 18000, endsAt: soon(10) } });
const liveOffer = r.body.data;
check('live offer sets hasActiveOffer', r.status === 201 && liveOffer.status === 'active' && (await Business.findById(bizId).lean()).hasActiveOffer === true);
r = await api(`/businesses/${bizId}/offers`, { as: as('owner'), method: 'POST', body: { title: 'December special', startsAt: soon(20), endsAt: soon(30) } });
check('future offer is "scheduled"', r.body.data.status === 'scheduled');
r = await api(`/businesses/${bizId}/offers`);
check('public list shows live offers only', r.body.data.length === 1 && r.body.data[0].id === liveOffer.id);
r = await api(`/businesses/${bizId}/offers?all=true`, { as: as('owner') });
check('owner sees scheduled offers too', r.body.data.length === 2);
await api(`/offers/${liveOffer.id}`, { as: as('owner'), method: 'DELETE' });
check('removing the only live offer clears hasActiveOffer', (await Business.findById(bizId).lean()).hasActiveOffer === false);
for (let i = 0; i < 4; i += 1) await api(`/businesses/${bizId}/offers`, { as: as('owner'), method: 'POST', body: { title: `Deal number ${i}` } });
r = await api(`/businesses/${bizId}/offers`, { as: as('owner'), method: 'POST', body: { title: 'One too many' } });
check('sixth running offer → 422 OFFER_LIMIT', r.status === 422 && r.body.error.code === 'OFFER_LIMIT');
const running = await Offer.findOne({ businessId: bizId, status: 'active', title: 'Deal number 0' }).lean();
r = await api(`/offers/${running._id}`, { as: as('owner'), method: 'PATCH', body: { endsAt: new Date(Date.now() - 60 * 60 * 1000).toISOString() } });
check('offer end before its start → 422 OFFER_TIMES', r.status === 422 && r.body.error.code === 'OFFER_TIMES');

// --- Privacy ---
const dumps = [await api('/posts?limit=50'), await api('/events?limit=50'), await api(`/posts/${thread.id}/comments`), await api(`/businesses/${bizId}/offers`)];
check('posts, comments, events and offers never leak private fields', dumps.every((d) => !PRIVATE.test(JSON.stringify(d.body))));

// --- Cleanup ---
const ids = (await User.find({ email: /@cm-smoke\.test$/ }, { _id: 1 }).lean()).map((u) => u._id);
const posts = (await Post.find({ authorId: { $in: ids } }, { _id: 1 }).lean()).map((p) => p._id);
await Promise.all([
  Post.deleteMany({ _id: { $in: posts } }), Comment.deleteMany({ postId: { $in: posts } }), Reaction.deleteMany({ postId: { $in: posts } }),
  Event.deleteMany({ hostId: { $in: ids } }), Rsvp.deleteMany({ userId: { $in: ids } }), Offer.deleteMany({ businessId: bizId }),
  Review.deleteMany({ businessId: bizId }), Business.deleteMany({ _id: bizId }),
]);
await User.deleteMany({ _id: { $in: ids } });
await recalcBusiness(bizId);
server.close();
await disconnectDb();
process.stdout.write(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}\n`);
process.exit(failures ? 1 : 0);
