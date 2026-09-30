// Phase 2 smoke test (NODE_ENV=test): webhook signatures and idempotency, user lifecycle,
// on-the-fly users, /api/me, preference validation, requireVerifiedEmail and requireRole.
//   npm run smoke:auth   (needs a MongoDB, e.g. `npm run db:memory`)
import express from 'express';
import { Webhook } from 'svix';
import { createApp } from '../src/app.js';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { clerkAuth, requireAuth, requireVerifiedEmail } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { requireRole } from '../src/middleware/requireRole.js';
import { User, WebhookEvent, syncIndexes } from '../src/models/index.js';
import { registerTestClerkUser } from '../src/services/clerk.js';
import { TEST_WEBHOOK_SECRET } from '../src/webhooks/clerk.js';

if (process.env.NODE_ENV !== 'test') throw new Error('Run with NODE_ENV=test');

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures += 1;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}\n`);
};

await connectDb();
await syncIndexes();
await User.deleteMany({ email: /@auth-smoke\.test$/ });
await WebhookEvent.deleteMany({ eventId: /^msg_smoke_/ });

// Main app plus a tiny side app for the guards (they're used by later-phase routes).
const main = createApp().listen(0);
const guards = express();
guards.use(express.json(), clerkAuth);
guards.get('/verified', requireAuth, requireVerifiedEmail, (req, res) => res.json({ data: 'ok' }));
guards.get('/owner', requireAuth, requireRole('owner'), (req, res) => res.json({ data: 'ok' }));
guards.use(errorHandler);
const side = guards.listen(0);
const url = (srv, path) => `http://127.0.0.1:${srv.address().port}${path}`;
const call = async (srv, path, { clerkId, method = 'GET', body, headers = {} } = {}) => {
  const res = await fetch(url(srv, path), {
    method,
    headers: { 'Content-Type': 'application/json', ...(clerkId ? { 'X-Test-Clerk-Id': clerkId } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
};

const wh = new Webhook(TEST_WEBHOOK_SECRET);
const clerkUser = (id, email, first, last, verified = true) => ({
  id,
  first_name: first,
  last_name: last,
  image_url: null,
  primary_email_address_id: 'idn_1',
  email_addresses: [{ id: 'idn_1', email_address: email, verification: { status: verified ? 'verified' : 'unverified' } }],
});
const sendWebhook = (msgId, type, data, { secret, timestamp } = {}) => {
  const payload = JSON.stringify({ type, data, object: 'event' });
  const when = timestamp ?? new Date();
  const sig = (secret ? new Webhook(secret) : wh).sign(msgId, when, payload);
  return call(main, '/api/webhooks/clerk', {
    method: 'POST',
    body: payload,
    headers: { 'svix-id': msgId, 'svix-timestamp': String(Math.floor(when.getTime() / 1000)), 'svix-signature': sig },
  });
};

// 1. Signed out
let r = await call(main, '/api/me');
check('GET /api/me signed out → 401', r.status === 401 && r.body?.error?.code === 'UNAUTHORIZED');

// 2. Webhook signatures
r = await call(main, '/api/webhooks/clerk', { method: 'POST', body: JSON.stringify({ type: 'user.created', data: {} }) });
check('webhook without signature → 400', r.status === 400 && r.body?.error?.code === 'INVALID_SIGNATURE');
r = await sendWebhook('msg_smoke_bad', 'user.created', clerkUser('user_smoke_a', 'nomsa@auth-smoke.test', 'Nomsa', 'Khumalo'), {
  secret: 'whsec_' + Buffer.from('a-different-secret-entirely').toString('base64'),
});
check('webhook signed with wrong secret → 400', r.status === 400);
r = await sendWebhook('msg_smoke_old', 'user.created', clerkUser('user_smoke_a', 'nomsa@auth-smoke.test', 'Nomsa', 'Khumalo'), {
  timestamp: new Date(Date.now() - 60 * 60 * 1000),
});
check('webhook with stale timestamp (replay) → 400', r.status === 400);
check('rejected webhooks created nothing', (await User.countDocuments({ clerkId: 'user_smoke_a' })) === 0);

// 3. Lifecycle
r = await sendWebhook('msg_smoke_1', 'user.created', clerkUser('user_smoke_a', 'Nomsa@Auth-Smoke.test', 'Nomsa', 'Khumalo'));
let doc = await User.findOne({ clerkId: 'user_smoke_a' }).lean();
check('user.created → user stored', r.status === 200 && doc?.displayName === 'Nomsa K.' && doc.emailVerified && doc.email === 'nomsa@auth-smoke.test');
r = await sendWebhook('msg_smoke_1', 'user.created', clerkUser('user_smoke_a', 'nomsa@auth-smoke.test', 'Nomsa', 'Khumalo'));
check('same svix id again → acknowledged as duplicate', r.status === 200 && r.body?.data?.duplicate === true);
check('retry did not duplicate the user', (await User.countDocuments({ clerkId: 'user_smoke_a' })) === 1);
await User.updateOne({ clerkId: 'user_smoke_a' }, { $set: { role: 'owner' } });
r = await sendWebhook('msg_smoke_2', 'user.updated', clerkUser('user_smoke_a', 'nomsa@auth-smoke.test', 'Nomsa', 'Dlamini'));
doc = await User.findOne({ clerkId: 'user_smoke_a' }).lean();
check('user.updated → name updated, role kept', doc.displayName === 'Nomsa D.' && doc.role === 'owner');

// 4. /api/me and privacy
r = await call(main, '/api/me', { clerkId: 'user_smoke_a' });
const raw = JSON.stringify(r.body);
check('GET /api/me → own account', r.status === 200 && r.body.data.email === 'nomsa@auth-smoke.test' && r.body.data.role === 'owner');
check('GET /api/me never exposes clerkId or internal fields', !/clerkId|user_smoke_a|credibility|status"|deletedAt|suspendedReason/.test(raw));

// 5. Preferences
r = await call(main, '/api/me/preferences', { clerkId: 'user_smoke_a', method: 'PATCH', body: { radiusKm: 5, categories: ['food', 'hair'], notifications: { weeklyDigest: true }, area: { township: 'dube', lat: -26.238671, lng: 27.890512 } } });
check('PATCH preferences updates only what was sent', r.status === 200 && r.body.data.preferences.radiusKm === 5 && r.body.data.preferences.notifications.weeklyDigest === true && r.body.data.preferences.notifications.newReview === true);
check('remembered area rounded to ~1 km', r.body?.data?.area?.lat === -26.24 && r.body?.data?.area?.lng === 27.89, JSON.stringify(r.body?.data?.area));
r = await call(main, '/api/me/preferences', { clerkId: 'user_smoke_a', method: 'PATCH', body: { role: 'admin' } });
check('PATCH can\'t set role (unknown key rejected)', r.status === 400 && r.body.error.code === 'VALIDATION_ERROR');
r = await call(main, '/api/me/preferences', { clerkId: 'user_smoke_a', method: 'PATCH', body: { $set: { role: 'admin' } } });
check('PATCH rejects "$" operator keys', r.status === 400);
r = await call(main, '/api/me/preferences', { clerkId: 'user_smoke_a', method: 'PATCH', body: { notifications: { weeklyDigest: 'yes' } } });
check('PATCH rejects wrong types', r.status === 400);
r = await call(main, '/api/me/preferences', { clerkId: 'user_smoke_a', method: 'PATCH', body: {} });
check('PATCH with nothing to change → 400', r.status === 400);
check('role still owner after injection attempts', (await User.findOne({ clerkId: 'user_smoke_a' }).lean()).role === 'owner');

// 6. On-the-fly creation (token valid, webhook not processed yet)
registerTestClerkUser({ clerkId: 'user_smoke_b', email: 'sipho@auth-smoke.test', emailVerified: false, firstName: 'Sipho', lastName: 'Ndlovu', avatarUrl: null });
r = await call(main, '/api/me', { clerkId: 'user_smoke_b' });
check('valid token without a user document → created on the fly', r.status === 200 && r.body.data.displayName === 'Sipho N.');
const [a, b] = await Promise.all([call(main, '/api/me', { clerkId: 'user_smoke_b' }), call(main, '/api/me', { clerkId: 'user_smoke_b' })]);
check('concurrent first requests create one user', a.status === 200 && b.status === 200 && (await User.countDocuments({ clerkId: 'user_smoke_b' })) === 1);

// 7. Guards
r = await call(side, '/verified', { clerkId: 'user_smoke_b' });
check('requireVerifiedEmail blocks unverified email → 403', r.status === 403 && r.body.error.code === 'EMAIL_NOT_VERIFIED');
r = await call(side, '/verified', { clerkId: 'user_smoke_a' });
check('requireVerifiedEmail allows verified email', r.status === 200);
r = await call(side, '/owner', { clerkId: 'user_smoke_b' });
check('requireRole("owner") blocks a customer → 403', r.status === 403);
r = await call(side, '/owner', { clerkId: 'user_smoke_a' });
check('requireRole("owner") allows an owner', r.status === 200);

// 8. Linking a seeded account by email (if the seed has run)
const seeded = await User.findOne({ email: 'u1@seed.blacklink.test', clerkId: null }).lean();
if (seeded) {
  await sendWebhook('msg_smoke_link', 'user.created', clerkUser('user_smoke_seed', 'u1@seed.blacklink.test', 'Thabo', 'Mokoena'));
  const linked = await User.findById(seeded._id).lean();
  check('user.created links an existing account with that email', linked.clerkId === 'user_smoke_seed' && (await User.countDocuments({ email: 'u1@seed.blacklink.test' })) === 1);
  await User.updateOne({ _id: seeded._id }, { $set: { clerkId: null, displayName: seeded.displayName, firstName: seeded.firstName, lastName: seeded.lastName } });
}

// 9. Soft delete
r = await sendWebhook('msg_smoke_3', 'user.deleted', { id: 'user_smoke_a', deleted: true, object: 'user' });
doc = await User.findOne({ clerkId: 'user_smoke_a' }).lean();
check('user.deleted → soft delete', r.status === 200 && doc.status === 'deleted' && doc.deletedAt instanceof Date);
r = await call(main, '/api/me', { clerkId: 'user_smoke_a' });
check('deleted account can\'t use the API → 403', r.status === 403);
await sendWebhook('msg_smoke_4', 'user.updated', clerkUser('user_smoke_a', 'nomsa@auth-smoke.test', 'Nomsa', 'Dlamini'));
check('a late user.updated does not resurrect a deleted account', (await User.findOne({ clerkId: 'user_smoke_a' }).lean()).status === 'deleted');
r = await sendWebhook('msg_smoke_5', 'session.created', { id: 'sess_1' });
check('unknown event types are acknowledged and ignored', r.status === 200 && r.body.data.handled === false);

await User.deleteMany({ email: /@auth-smoke\.test$/ });
await WebhookEvent.deleteMany({ eventId: /^msg_smoke_/ });
main.close();
side.close();
await disconnectDb();
process.stdout.write(`\n${failures ? `${failures} check(s) failed` : 'All checks passed'}\n`);
process.exit(failures ? 1 : 0);
