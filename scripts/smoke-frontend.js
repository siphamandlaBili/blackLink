// Phase 8 smoke test (NODE_ENV=test, seeded database): runs the frontend's own API services
// (src/services/api/*) against this server, so adapters, paging, filters, optimistic-toggle
// endpoints, reviews, events and onboarding publish are checked end to end.
//   NODE_ENV=test npm run smoke:frontend
// Needs the frontend repo checked out with its dependencies installed. Set FRONTEND_DIR to
// its folder if it is not found automatically (see scripts/lib/frontendDir.mjs).
import { register } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { findFrontend } from './lib/frontendDir.mjs';
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Business, Event, Review, Rsvp, User } from '../src/models/index.js';
import { registerTestUpload } from '../src/services/cloudinary.js';
import { registerTestClerkUser } from '../src/services/clerk.js';

if (process.env.NODE_ENV !== 'test') throw new Error('Run with NODE_ENV=test');
const feRoot = findFrontend();
const fe = pathToFileURL(join(feRoot, 'src')).href;
// Only the frontend's own files get the Vite treatment (extensionless imports, import.meta.env).
register('./lib/vite-loader.mjs', { parentURL: import.meta.url, data: { frontendSrc: `${fe}/` } });

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
};

await connectDb();
const server = createApp().listen(0);
const origin = `http://127.0.0.1:${server.address().port}`;

// The browser would send a Clerk token; tests send X-Test-Clerk-Id. Uploads to Cloudinary
// are faked and registered so the server's upload check passes. `failNext` simulates a
// dropped connection for the retry check.
const realFetch = globalThis.fetch;
const net = { as: null, failNext: 0, calls: 0 };
globalThis.fetch = async (url, init = {}) => {
  const href = String(url);
  if (href.startsWith('https://api.cloudinary.com/')) {
    const publicId = `${init.body.get('folder')}/${init.body.get('public_id')}`;
    registerTestUpload(publicId, {});
    return new Response(JSON.stringify({ public_id: publicId }), { status: 200 });
  }
  if (href.startsWith(origin)) {
    net.calls += 1;
    if (net.failNext > 0) {
      net.failNext -= 1;
      throw new TypeError('fetch failed');
    }
    const headers = { ...(init.headers ?? {}), ...(net.as ? { 'X-Test-Clerk-Id': net.as } : {}) };
    return realFetch(url, { ...init, headers });
  }
  return realFetch(url, init);
};

globalThis.__VITE_ENV__ = { VITE_API_URL: origin, VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_smoke' };
const { USE_MOCKS } = await import(`${fe}/config/api.js`);
const { ApiError, api } = await import(`${fe}/services/apiClient.js`);
const biz = await import(`${fe}/services/api/businessApi.js`);
const rev = await import(`${fe}/services/api/reviewApi.js`);
const ev = await import(`${fe}/services/api/eventApi.js`);
const acct = await import(`${fe}/services/api/accountApi.js`);
const own = await import(`${fe}/services/api/ownerApi.js`);
const { toAccount } = await import(`${fe}/services/api/adapters.js`);
const { DEFAULT_FILTERS } = await import(`${fe}/components/explore/filterBusinesses.js`);
const { DEFAULT_FILTERS: DEFAULT_NEARBY_FILTERS } = await import(`${fe}/store/useNearbyStore.js`);
const { createDraft } = await import(`${fe}/store/useOnboardingStore.js`);
const { useAuthStore } = await import(`${fe}/store/useAuthStore.js`);

const PEOPLE = {
  me: { clerkId: 'user_fe_me', email: 'me@fe-smoke.test', emailVerified: true, firstName: 'Lerato', lastName: 'Dube' },
  customer: { clerkId: 'user_fe_customer', email: 'customer@fe-smoke.test', emailVerified: true, firstName: 'Sipho', lastName: 'Nkosi' },
};
Object.values(PEOPLE).forEach((p) => registerTestClerkUser({ avatarUrl: null, ...p }));
const cleanup = async () => {
  const users = await User.find({ email: /@fe-smoke\.test$/ }, { _id: 1 }).lean();
  const ids = users.map((u) => u._id);
  const events = await Event.find({ hostId: { $in: ids } }, { _id: 1 }).lean();
  await Promise.all([Review.deleteMany({ authorId: { $in: ids } }), Business.deleteMany({ ownerId: { $in: ids } }), Event.deleteMany({ hostId: { $in: ids } }), Rsvp.deleteMany({ $or: [{ userId: { $in: ids } }, { eventId: { $in: events.map((e) => e._id) } }] })]);
  await User.deleteMany({ _id: { $in: ids } });
};
await cleanup();

const nearbyFilters = {
  radiusKm: 2, sort: 'best', categories: [], openNow: false, minRating: 0, minTrust: 0, priceLevels: [],
  minVerification: 'phone', newThisMonth: false, hasOffers: false, backupPower: false,
  ...DEFAULT_NEARBY_FILTERS,
  radiusKm: 2,
};
const VILAKAZI = { lat: -26.2385, lng: 27.9086 };

try {
  check('API mode is on when URL and Clerk key are set', USE_MOCKS === false);

  // --- Explore -------------------------------------------------------------------------
  const p1 = await biz.searchBusinesses({ filters: DEFAULT_FILTERS, sort: 'rating' });
  const b0 = p1.items[0];
  check('explore: first page has cards and a total', p1.items.length === 24 && p1.total >= p1.items.length, `${p1.items.length} of ${p1.total}`);
  check(
    'explore: card maps to the UI Business shape',
    b0 && typeof b0.slug === 'string' && b0.location.township && ['open', 'closingSoon', 'closed'].includes(b0.openStatus?.status) && typeof b0.trustTier === 'string' && Array.isArray(b0.offers),
  );
  check('explore: no private fields on cards', !JSON.stringify(p1.items).match(/nameLower|openRanges|cipcNumber/));
  const p2 = await biz.searchBusinesses({ filters: DEFAULT_FILTERS, sort: 'rating', cursor: p1.nextCursor });
  const ids = new Set(p1.items.map((b) => b.id));
  check('explore: page 2 continues without repeats', p2.items.length > 0 && p2.items.every((b) => !ids.has(b.id)) && p2.total === null);
  const ratings = p1.items.map((b) => b.rating);
  check('explore: "rating" sort is highest first', ratings.every((r, i) => i === 0 || ratings[i - 1] >= r));

  const az1 = await biz.searchBusinesses({ filters: DEFAULT_FILTERS, sort: 'az' });
  const az2 = await biz.searchBusinesses({ filters: DEFAULT_FILTERS, sort: 'az', cursor: az1.nextCursor });
  const names = [...az1.items, ...az2.items].map((b) => b.name.toLowerCase());
  check('explore: A–Z sort pages in name order', names.every((n, i) => i === 0 || names[i - 1] <= n) && new Set(names).size === names.length);

  const food = await biz.searchBusinesses({ filters: { ...DEFAULT_FILTERS, categories: ['food'] }, sort: 'rating' });
  const foodCount = await Business.countDocuments({ status: 'published', category: 'food' });
  check('explore: category filter and total match the database', food.items.every((b) => b.category === 'food') && food.total === foodCount, `${food.total} vs ${foodCount}`);
  const open = await biz.searchBusinesses({ filters: { ...DEFAULT_FILTERS, openNow: true }, sort: 'rating' });
  check('explore: "open now" returns only open businesses', open.items.every((b) => b.openStatus.status !== 'closed'));
  const q = await biz.searchBusinesses({ filters: { ...DEFAULT_FILTERS, q: 'sakhumzi' }, sort: 'rating' });
  check('explore: search finds by name', q.items.some((b) => /sakhumzi/i.test(b.name)));
  const byName = await biz.searchByName('sak');
  check('nearby place search: name prefix', byName.some((b) => /^sak/i.test(b.name)));

  // --- Nearby ----------------------------------------------------------------------------
  const near = await biz.findNearby({ point: VILAKAZI, filters: nearbyFilters, interests: ['food'] });
  check('nearby: results within the radius', near.results.length > 0 && near.results.every((r) => r.distanceKm <= 2.01), `${near.results.length}`);
  check('nearby: reasons mapped, distance first', near.results.every((r) => r.reasons[0]?.key === 'distance' && typeof r.reasons[0].km === 'number'));
  check('nearby: only UI reason keys', near.results.every((r) => r.reasons.every((x) => ['distance', 'open', 'closingSoon', 'trust', 'rating', 'interest'].includes(x.key))));
  check('nearby: guest interests reach the score', near.results.some((r) => r.reasons.some((x) => x.key === 'interest')));
  const far = await biz.findNearby({ point: { lat: -26.305, lng: 27.785 }, filters: { ...nearbyFilters, radiusKm: 0.5 } });
  check('nearby: empty radius suggests how far to expand', far.results.length === 0 && typeof far.expandTo === 'number' && !far.filteredOut, `expandTo ${far.expandTo}`);

  // --- Profile, reviews, events, home ---------------------------------------------------
  const slug = b0.slug;
  const prof = await biz.getProfile(slug);
  const hours = prof.business?.hours;
  check('profile: loads with UI hours shape', hours && Object.values(hours).every((d) => d === null || (typeof d.open === 'string' && typeof d.close === 'string')));
  check('profile: similar pool is same category', prof.similarPool.every((b) => b.category === prof.business.category));
  check('profile: guest sees no owner id', prof.business.ownerId === null);
  check('profile: unknown slug is "not found", not an error', (await biz.getProfile('no-such-business-xyz')).business === null);

  const reviews = await rev.getReviewsForBusiness(prof.business.id);
  check('reviews: load with public author names', reviews.length > 0 && reviews.every((r) => r.author && 'name' in r.author && r.author.isYou === false));

  const events = await ev.listEvents();
  check('events: upcoming, soonest first, with hosts', events.length > 0 && events.every((e, i) => i === 0 || events[i - 1].startsAt <= e.startsAt) && events.some((e) => e.host?.slug));
  check('events: price in rand, attendees a number', events.every((e) => typeof e.price === 'number' && typeof e.attendees === 'number'));
  const home = await biz.getHomeBusinesses();
  check('home: trending and directory count', home.trending.length > 0 && home.businessCount > 0);

  // --- Errors ---------------------------------------------------------------------------
  try {
    await biz.setFollowing(b0.id, true);
    check('guest follow is refused', false);
  } catch (err) {
    check('guest follow is refused with ApiError 401', err instanceof ApiError && err.status === 401, err.code);
  }
  net.failNext = 1;
  const before = net.calls;
  const retried = await api.get('/health').catch((e) => e);
  check('network blip: GET retried once and succeeds', !(retried instanceof Error) && net.calls - before === 2);
  net.failNext = 1;
  const posted = await api.post('/businesses', {}).catch((e) => e);
  check('network blip: POST not retried', posted instanceof ApiError && posted.code === 'NETWORK_ERROR' && net.failNext === 0);

  // --- Signed in ------------------------------------------------------------------------
  net.as = PEOPLE.me.clerkId;
  const { data: meRaw } = await api.get('/me');
  const me = toAccount(meRaw);
  useAuthStore.setState({ user: me, ready: true });
  check('account: /me maps to the UI account', me.firstName === 'Lerato' && me.email === PEOPLE.me.email && me.phone === null);
  check('engagement: starts empty, no saved list', JSON.stringify(await biz.getEngagement()) === JSON.stringify({ following: [], going: [] }));

  await biz.setFollowing(b0.id, true);
  let eng = await biz.getEngagement();
  check('follow is recorded', eng.following.includes(b0.id));
  const followedProfile = await biz.getProfile(slug);
  check('profile: follower count excludes you (UI adds you back)', followedProfile.business.followers === prof.business.followers);
  check('profile: viewer flags have no "saved"', followedProfile.business.viewer.following === true && !('saved' in followedProfile.business.viewer));
  const gone = await api.post(`/businesses/${b0.id}/save`).catch((e) => e);
  check('save endpoint is gone', gone instanceof ApiError && gone.status === 404);

  // Review someone else's business: pick one with reviews but not reviewed by me.
  const target = p1.items.find((b) => b.id !== b0.id) ?? b0;
  try {
    await rev.submitReview(target.id, { rating: 5, text: 'short', tags: [], visited: false });
    check('review: too-short text refused', false);
  } catch (err) {
    check('review: too-short text refused with a readable ApiError', err instanceof ApiError && err.status === 400 && err.message.length > 0, err.code);
  }
  const mine = await rev.submitReview(target.id, {
    rating: 4, subRatings: { service: 5, value: 0 }, text: 'Lovely service and fair prices, will come back soon.', tags: ['Friendly'], visited: false,
  });
  check('review: posted and marked as yours', mine.author.isYou && mine.rating === 4 && mine.subRatings.value === undefined);
  const edited = await rev.updateReview(target.id, { rating: 5, subRatings: {}, text: 'Lovely service and fair prices, came back and it was even better.', tags: [], visited: false }, mine.id);
  check('review: edit uses the review id', edited.edited && edited.rating === 5);
  const list = await rev.getReviewsForBusiness(target.id);
  check('review: your review is listed first', list[0]?.id === mine.id && list[0].author.isYou);

  const other = list.find((r) => !r.author.isYou);
  if (other) {
    await rev.setHelpful(other.id, true);
    const again = (await rev.getReviewsForBusiness(target.id)).find((r) => r.id === other.id);
    check('helpful: vote recorded; UI count excludes your vote', again.viewerHelpful === true && again.helpfulCount === other.helpfulCount);
    const reported = await rev.reportReview(other.id, 'conflict');
    check('report: UI reason mapped to API reason', reported.ok);
  }

  const event = events[0];
  await ev.setGoing(event.id, true);
  eng = await biz.getEngagement();
  const going = (await ev.listEvents()).find((e) => e.id === event.id);
  check('going: recorded, and attendees exclude you', eng.going.includes(event.id) && going.viewerGoing === true && going.attendees === event.attendees);

  // --- Onboarding publish ---------------------------------------------------------------
  const pixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const draft = createDraft();
  Object.assign(draft.account, { ownerId: me.id, phone: null, verified: true, email: me.email, consent: true });
  Object.assign(draft.basics, { name: 'Lerato Smoke Kitchen', owner: 'Lerato Dube', since: '2019', category: 'food', description: 'Kota and chips.', tags: ['kota'] });
  Object.assign(draft.location, { township: 'orlando-west', find: 'Next to the tuck shop' });
  Object.assign(draft.contact, { sameAsPhone: false, whatsapp: '071 234 5678', website: 'lerato.example.co.za', pay: ['cash', 'snapscan'], price: 2 });
  draft.media = { logo: { dataUrl: pixel }, cover: { dataUrl: pixel }, gallery: [{ dataUrl: pixel }] };
  Object.assign(draft.offer, { title: 'Kota Tuesday', price: '35', validUntil: '2099-12-31' });
  // Autosave: the draft is saved to the account, resumed with its photos, and can be discarded.
  const drafts = await import(`${fe}/services/api/draftApi.js`);
  const half = createDraft();
  Object.assign(half.account, { ownerId: me.id, consent: true });
  Object.assign(half.basics, { name: 'L', category: 'food' });
  Object.assign(half.contact, { sameAsPhone: false, whatsapp: '071 23' });
  const first = await drafts.saveDraft({ draft: half, step: 1, serverId: null });
  check('draft: half-filled answers save without errors', typeof first.serverId === 'string');
  const uploaded = [];
  const second = await drafts.saveDraft({ draft, step: 5, serverId: first.serverId }, (img, id) => uploaded.push(id));
  const resumed = await drafts.loadDraft(me);
  check('draft: resumes on another device with step, fields and photos', resumed?.serverId === first.serverId && resumed.step === 5 && resumed.draft.basics.name === 'Lerato Smoke Kitchen' && uploaded.length === 3 && uploaded.includes(resumed.draft.media.cover?.publicId) && resumed.draft.media.gallery.length === 1 && resumed.draft.contact.whatsapp.replace(/\D/g, '') === '27712345678', JSON.stringify({ id: resumed?.serverId === first.serverId, step: resumed?.step, name: resumed?.draft.basics.name, up: uploaded.length, cover: resumed?.draft.media.cover?.publicId?.slice(-12), gal: resumed?.draft.media.gallery.length }));
  const throwaway = await drafts.saveDraft({ draft: half, step: 0, serverId: null });
  await drafts.deleteDraft(throwaway.serverId);
  check('draft: "start over" deletes the saved draft', !(await Business.exists({ _id: throwaway.serverId })));
  resumed.draft.offer = draft.offer; // offers aren't part of the saved draft
  const { business: published, mediaDropped } = await biz.publishDraft(resumed.draft, { serverId: second.serverId });
  check('publish: reuses the saved draft (no duplicate listing)', published.id === first.serverId && (await Business.countDocuments({ ownerId: meRaw.id })) === 1);
  check('publish: listing goes live with photos', published.status === 'published' && !mediaDropped && Boolean(published.cover) && published.gallery.length === 1);
  check('publish: township centre used without a pin', typeof published.location.lat === 'number');
  check('publish: website normalised, WhatsApp kept', published.website === 'https://lerato.example.co.za/' && published.whatsapp === '27712345678');
  const ownView = await biz.getProfile(published.slug);
  check('publish: owner sees it as theirs; offer attached', ownView.business.ownerId === me.id && ownView.business.offers.some((o) => o.title === 'Kota Tuesday' && o.priceCents === 3500));

  // --- Profile page ---------------------------------------------------------------------
  const profileMe = await acct.getMe();
  check('profile: account with counts and owner role', profileMe.role === 'owner' && profileMe.reviewCount === 1 && Array.isArray(profileMe.badges));
  const following = await acct.getMyBusinesses();
  check('profile: following list has cards', following.some((b) => b.id === b0.id && b.slug));
  const savedList = await api.get('/me/businesses?list=saved').catch((e) => e);
  check('profile: there is no saved list any more', savedList instanceof ApiError && savedList.status === 400);
  const myEvents = await acct.getMyEvents();
  check("profile: events I'm going to", myEvents.some((e) => e.id === event.id && e.host !== undefined));
  const myReviews = await acct.getMyReviews();
  check('profile: my reviews with the business they are about', myReviews.items[0]?.id === mine.id && myReviews.items[0].business?.slug === target.slug);
  const notes = await acct.getNotifications();
  check('profile: notifications with an unread count', Array.isArray(notes.items) && typeof notes.unreadCount === 'number');
  if (notes.items[0]) {
    await acct.markAllNotificationsRead();
    check('profile: mark all read', (await acct.getNotifications()).unreadCount === 0);
  }
  const prefs = await acct.updatePreferences({ notifications: { product: false } });
  check('profile: email preference saved', prefs.notifications.product === false);

  // --- Business dashboard ---------------------------------------------------------------
  const listings = await own.getMyListings();
  check('dashboard: my listings include the published one', listings.some((l) => l.id === published.id && l.status === 'published'));
  net.as = null;
  await api.post('/track', { businessId: published.id, event: 'view' });
  await api.post('/track', { businessId: published.id, event: 'whatsapp' });
  net.as = PEOPLE.customer.clerkId;
  await rev.submitReview(published.id, { rating: 4, text: 'Great kota, friendly service and quick too. Recommended.', tags: [], visited: false });
  net.as = PEOPLE.me.clerkId;
  let dash = await own.getDashboard(published.id, 30);
  check('dashboard: stats, 30-day series and trust', dash.business.id === published.id && dash.engagement.series.length === 30 && dash.engagement.totals.views >= 1 && dash.engagement.totals.whatsappClicks >= 1 && dash.trust.tier === 'building');
  check('dashboard: new review waiting for a reply', dash.reviews.unansweredCount === 1 && dash.reviews.unanswered[0].author);
  await own.replyToReview(dash.reviews.unanswered[0].id, 'Thank you Sipho, see you on Tuesday!');
  dash = await own.getDashboard(published.id, 90);
  check('dashboard: reply clears the queue and lifts the response rate', dash.reviews.unansweredCount === 0 && dash.reviews.responseRate > 0 && dash.engagement.series.length === 90);
  const created = await own.createOffer(published.id, { title: 'Free chips with any kota', priceCents: 4500 });
  let offersNow = await own.listOffers(published.id);
  check('dashboard: offers list includes new and opening offers', offersNow.some((o) => o.id === created.id && o.status === 'active') && offersNow.some((o) => o.title === 'Kota Tuesday'));
  await own.endOffer(created.id);
  offersNow = await own.listOffers(published.id);
  check('dashboard: ended offer is no longer live', offersNow.find((o) => o.id === created.id)?.status !== 'active');
  const listing = await own.getListing(published.slug);
  check('dashboard: listing loads with form hours', listing.uiHours && 'mon' in listing.uiHours);
  const updated = await own.updateListing(published.id, { description: 'Kota, chips and cold drinks.', backupPower: true, hours: listing.uiHours });
  check('dashboard: listing details saved', updated.description === 'Kota, chips and cold drinks.' && updated.backupPower === true);
  const refusal = await drafts.deleteDraft(published.id).catch((e) => e);
  check('dashboard: a live listing cannot be deleted as a draft', refusal instanceof ApiError && refusal.status === 409);
  net.as = PEOPLE.customer.clerkId;
  const intruder = await own.getDashboard(published.id).catch((e) => e);
  check("dashboard: another member can't open it", intruder instanceof ApiError && intruder.status === 403);
  net.as = PEOPLE.me.clerkId;

  // --- Hosting events -------------------------------------------------------------------
  const { sastToIso, isoToSast } = await import(`${fe}/components/events/eventTime.js`);
  const nextWeek = isoToSast(new Date(Date.now() + 7 * 86400000).toISOString()).date;
  check('events: SAST date and time round-trip', JSON.stringify(isoToSast(sastToIso(nextWeek, '09:30'))) === JSON.stringify({ date: nextWeek, time: '09:30' }) && sastToIso(nextWeek, '09:30').endsWith('07:30:00.000Z'));
  const hosted = await ev.createEvent({
    title: 'Kota Tasting Afternoon', type: 'shisanyama', description: 'Try every kota on the menu.', venue: 'Lerato Smoke Kitchen',
    township: 'orlando-west', location: { lat: -26.2386, lng: 27.9087 }, startsAt: sastToIso(nextWeek, '13:00'), endsAt: sastToIso(nextWeek, '17:00'),
    priceCents: 5000, capacity: 1, businessId: published.id,
  });
  check('events: owner hosts as their business', hosted.host?.id === published.id && hosted.canEdit && hosted.price === 50 && typeof hosted.slug === 'string');
  const page = await ev.getEvent(hosted.slug);
  check('events: event page loads by slug', page?.id === hosted.id && page.status === 'scheduled');
  check('events: unknown slug is "not found"', (await ev.getEvent('no-such-event-xyz')) === null);
  const moved = await ev.updateEvent(hosted.id, { venue: 'Orlando West Hall', capacity: 2, businessId: 'ignored' });
  check('events: host edits details (host business stays)', moved.venue === 'Orlando West Hall' && moved.capacity === 2 && moved.host?.id === published.id);
  check('events: listed under my hosted events and the business', (await ev.getHostedEvents()).some((e) => e.id === hosted.id) && (await ev.listBusinessEvents(published.id)).some((e) => e.id === hosted.id));
  net.as = PEOPLE.customer.clerkId;
  const notHost = await ev.updateEvent(hosted.id, { title: 'Hijacked event' }).catch((e) => e);
  check("events: other members can't edit", notHost instanceof ApiError && notHost.status === 403);
  const asOther = await ev.createEvent({ title: 'Borrowed name', type: 'market', venue: 'Somewhere', township: 'dube', location: { lat: -26.24, lng: 27.89 }, startsAt: sastToIso(nextWeek, '10:00'), endsAt: sastToIso(nextWeek, '12:00'), priceCents: 0, businessId: published.id }).catch((e) => e);
  check("events: can't host as someone else's business", asOther instanceof ApiError && asOther.status === 403);
  const guestEvent = await ev.createEvent({ title: 'Street Clean-up', type: 'market', venue: 'Dube Park', township: 'dube', location: { lat: -26.24, lng: 27.89 }, startsAt: sastToIso(nextWeek, '08:00'), endsAt: sastToIso(nextWeek, '11:00'), priceCents: 0 });
  check('events: any verified member can host without a business', guestEvent.host === null && guestEvent.canEdit);
  await ev.setGoing(hosted.id, true);
  net.as = PEOPLE.me.clerkId;
  await ev.cancelEvent(hosted.id);
  const cancelledPage = await ev.getEvent(hosted.slug);
  check('events: cancel shows on the event page and drops from listings', cancelledPage.status === 'cancelled' && !(await ev.listEvents()).some((e) => e.id === hosted.id) && (await ev.getHostedEvents()).some((e) => e.id === hosted.id && e.status === 'cancelled'));
} catch (err) {
  failures += 1;
  process.stdout.write(`FAIL  unexpected error: ${err?.stack ?? err}\n`);
} finally {
  await cleanup();
  server.close();
  await disconnectDb();
}

process.stdout.write(failures ? `\n${failures} check(s) failed\n` : '\nAll frontend integration checks passed\n');
process.exit(failures ? 1 : 0);
