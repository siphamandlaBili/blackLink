// Checks every service key in .env against the real service, read-only, and never prints
// a secret. Run after pasting keys:  npm run check:keys
import { createClerkClient } from '@clerk/express';
import mongoose from 'mongoose';

const env = process.env;
const results = [];
const report = (service, status, detail) => results.push({ service, status, detail });
const has = (...keys) => keys.every((k) => env[k] && env[k].trim() !== '');
const safe = (msg) => String(msg ?? '').replace(/(sk|pk)_(test|live)_[A-Za-z0-9]+/g, '$1_***').replace(/\/\/[^@]+@/g, '//***@').slice(0, 160);

async function mongo() {
  if (!has('MONGODB_URI')) return report('MongoDB', 'missing', 'MONGODB_URI is empty');
  try {
    await mongoose.connect(env.MONGODB_URI, { dbName: env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 15000 });
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    report('MongoDB', hello.setName ? 'ok' : 'warn', hello.setName ? `replica set "${hello.setName}", transactions available` : 'connected, but not a replica set: transactions (Phase 4) will fail');
  } catch (e) {
    report('MongoDB', 'fail', safe(e.message));
  } finally {
    await mongoose.disconnect().catch(() => {});
  }
}

async function clerk() {
  if (!has('CLERK_PUBLISHABLE_KEY', 'CLERK_SECRET_KEY')) return report('Clerk', 'missing', 'CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY are needed');
  const pk = env.CLERK_PUBLISHABLE_KEY;
  const sk = env.CLERK_SECRET_KEY;
  if (!/^pk_(test|live)_/.test(pk) || !/^sk_(test|live)_/.test(sk)) return report('Clerk', 'fail', 'keys should start with pk_test_/pk_live_ and sk_test_/sk_live_');
  if (pk.split('_')[1] !== sk.split('_')[1]) return report('Clerk', 'fail', 'publishable and secret keys are from different environments (test vs live)');
  try {
    const client = createClerkClient({ secretKey: sk, publishableKey: pk });
    const list = await client.users.getUserList({ limit: 1 });
    // The publishable key encodes the Frontend API host; decoding it confirms it isn't truncated.
    const host = Buffer.from(pk.split('_')[2], 'base64').toString('utf8').replace(/\$$/, '');
    report('Clerk', 'ok', `secret key accepted (${list.totalCount} user(s)); instance ${host}`);
  } catch (e) {
    report('Clerk', 'fail', e?.status === 401 ? 'secret key rejected (401)' : safe(e?.errors?.[0]?.message ?? e.message));
  }
}

function clerkWebhook() {
  if (!has('CLERK_WEBHOOK_SECRET')) return report('Clerk webhook', 'missing', 'add an endpoint in Clerk > Webhooks, then copy its signing secret');
  const ok = /^whsec_[A-Za-z0-9+/=]{20,}$/.test(env.CLERK_WEBHOOK_SECRET);
  report('Clerk webhook', ok ? 'ok' : 'fail', ok ? 'format looks right (it can only be fully tested by a real delivery)' : 'should start with whsec_');
}

async function cloudinary() {
  if (!has('CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET')) return report('Cloudinary', 'later', 'needed from Phase 5 (uploads)');
  try {
    const auth = Buffer.from(`${env.CLOUDINARY_API_KEY}:${env.CLOUDINARY_API_SECRET}`).toString('base64');
    const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(env.CLOUDINARY_CLOUD_NAME)}/ping`, { headers: { Authorization: `Basic ${auth}` } });
    report('Cloudinary', res.ok ? 'ok' : 'fail', res.ok ? 'credentials accepted' : `HTTP ${res.status} (check cloud name, key and secret)`);
  } catch (e) {
    report('Cloudinary', 'fail', safe(e.message));
  }
}

async function resend() {
  if (!has('RESEND_API_KEY')) return report('Resend', 'later', 'needed from Phase 6 (emails)');
  const from = /@([^>\s]+)>?\s*$/.exec(env.EMAIL_FROM ?? '')?.[1]?.toLowerCase();
  // Resend only sends from domains you've verified; nobody can verify a public mailbox domain.
  const MAILBOXES = ['gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'webmail.co.za', 'mweb.co.za', 'telkomsa.net'];
  if (!from) return report('Resend', 'fail', 'EMAIL_FROM needs an address, e.g. "Black Link <hello@mail.yourdomain.co.za>"');
  if (MAILBOXES.includes(from)) return report('Resend', 'fail', `EMAIL_FROM can't use ${from}: use onboarding@resend.dev for testing, or an address on a domain verified in Resend`);
  try {
    const res = await fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401 && body.name === 'restricted_api_key') {
      // A sending-only key is the safer choice for the app; it just can't list domains.
      return report('Resend', from === 'resend.dev' ? 'warn' : 'ok', `sending-only key accepted; can't list domains, so make sure ${from} is verified in Resend${from === 'resend.dev' ? ' (resend.dev test sender only delivers to your own Resend email)' : ''}`);
    }
    if (!res.ok) return report('Resend', 'fail', `HTTP ${res.status} (key rejected)`);
    if (from === 'resend.dev') return report('Resend', 'warn', 'key accepted; resend.dev test sender only delivers to your own Resend email');
    const domain = (body.data ?? []).find((d) => d.name === from);
    report('Resend', domain?.status === 'verified' ? 'ok' : 'warn', domain ? `domain ${from}: ${domain.status}` : `key accepted; EMAIL_FROM domain "${from}" isn't added in Resend yet`);
  } catch (e) {
    report('Resend', 'fail', safe(e.message));
  }
}

function jobs() {
  const ok = has('JOB_SECRET') && env.JOB_SECRET.length >= 32;
  report('Job secret', ok ? 'ok' : 'missing', ok ? `${env.JOB_SECRET.length} characters` : 'needs at least 32 random characters');
}

await mongo();
await clerk();
clerkWebhook();
await cloudinary();
await resend();
jobs();

const icon = { ok: 'OK     ', warn: 'WARN   ', fail: 'FAIL   ', missing: 'MISSING', later: 'LATER  ' };
for (const r of results) process.stdout.write(`${icon[r.status]}  ${r.service.padEnd(14)} ${r.detail}\n`);
process.exit(results.some((r) => r.status === 'fail') ? 1 : 0);
