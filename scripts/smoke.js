// Phase 1 smoke test against a running database (e.g. `npm run db:memory` + seed).
// Boots the app on a random port and checks the foundation end to end.
//   npm run smoke
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { Business, Event, HeritageSite, Review, User, syncIndexes } from '../src/models/index.js';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
};

await connectDb();
await syncIndexes();
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const req = (path, init = {}) => fetch(base + path, init);

// Health
let res = await req('/api/health');
let body = await res.json();
check('health 200 with db up', res.status === 200 && body.data?.db === 'up', JSON.stringify(body.data));
check('request id header', /^[0-9a-f-]{36}$/.test(res.headers.get('x-request-id') ?? ''));
check('helmet headers', res.headers.get('x-content-type-options') === 'nosniff' && !res.headers.get('x-powered-by'));
check('rate limit headers', Boolean(res.headers.get('ratelimit') ?? res.headers.get('ratelimit-policy')));
res = await req('/api/health', { headers: { 'X-Request-Id': 'support-ticket-1234' } });
check('reuses a sane incoming request id', res.headers.get('x-request-id') === 'support-ticket-1234');

// Error format
res = await req('/api/does-not-exist');
body = await res.json();
check('404 uses the error format', res.status === 404 && body.error?.code === 'NOT_FOUND' && !body.data);
res = await req('/api/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"broken": ' });
body = await res.json();
check('invalid JSON → 400 INVALID_JSON', res.status === 400 && body.error?.code === 'INVALID_JSON');
res = await req('/api/health', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(150 * 1024) }) });
body = await res.json();
check('body over 100 kb → 413', res.status === 413 && body.error?.code === 'PAYLOAD_TOO_LARGE');

// CORS
res = await req('/api/health', { headers: { Origin: env.CLIENT_URL } });
check('CORS allows CLIENT_URL', res.headers.get('access-control-allow-origin') === env.CLIENT_URL);
res = await req('/api/health', { headers: { Origin: 'https://evil.example' } });
body = await res.json();
check('CORS rejects other origins', res.status === 403 && body.error?.code === 'CORS_REJECTED');

// Indexes
const names = async (model) => (await model.collection.indexes()).map((i) => ({ key: i.key, unique: Boolean(i.unique) }));
const bi = await names(Business);
check('businesses: 2dsphere on location', bi.some((i) => i.key.location === '2dsphere'));
check('businesses: text index', bi.some((i) => i.key._fts === 'text'));
check('businesses: unique slug', bi.some((i) => i.key.slug === 1 && i.unique));
check('events: 2dsphere on location', (await names(Event)).some((i) => i.key.location === '2dsphere'));
check('heritage: 2dsphere on location', (await names(HeritageSite)).some((i) => i.key.location === '2dsphere'));
check('reviews: unique (businessId, authorId)', (await names(Review)).some((i) => i.key.businessId === 1 && i.key.authorId === 1 && i.unique));
check('users: unique clerkId', (await names(User)).some((i) => i.key.clerkId === 1 && i.unique));

// Data sanity: a real $geoNear from Vilakazi Street, 1 km.
const near = await Business.aggregate([
  { $geoNear: { near: { type: 'Point', coordinates: [27.9087, -26.2386] }, distanceField: 'distanceM', maxDistance: 1000, query: { status: 'published' } } },
  { $project: { name: 1, distanceM: { $round: ['$distanceM', 0] } } },
]);
check('$geoNear finds businesses near Vilakazi Street', near.length > 0, near.map((b) => `${b.name} ${b.distanceM}m`).join(', '));
const scored = await Business.countDocuments({ status: 'published', 'trust.calculatedAt': { $ne: null } });
check('every published business has a Trust Score', scored === (await Business.countDocuments({ status: 'published' })), `${scored} scored`);
const outside = await Business.countDocuments({
  $or: [{ 'location.coordinates.0': { $lt: 27.78 } }, { 'location.coordinates.0': { $gt: 27.98 } }, { 'location.coordinates.1': { $lt: -26.31 } }, { 'location.coordinates.1': { $gt: -26.19 } }],
});
check('all coordinates are [lng, lat] inside Soweto', outside === 0);

server.close();
await disconnectDb();
process.stdout.write(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}\n`);
process.exit(failures ? 1 : 0);
