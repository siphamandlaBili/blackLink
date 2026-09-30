// One-off: exports the frontend's mock data (src/data) to JSON seed files for the API.
// Dates become offsets ("daysAgo", "inDays") so the seed always looks current.
// Needs the frontend repo checked out (found automatically, or set FRONTEND_DIR).
// Uses the frontend's esbuild.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findFrontend } from './lib/frontendDir.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = findFrontend();
const out = join(here, 'seed-data');
const tmp = join(here, '.export-tmp');
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });

// Bundle the frontend data modules (extensionless imports, JSON) into one Node-runnable file.
const entry = join(tmp, 'entry.mjs');
const src = (p) => JSON.stringify(join(root, p).replace(/\\/g, '/'));
writeFileSync(
  entry,
  `export { BUSINESSES, SEED_REVIEWS } from ${src('src/data/businesses.js')};
export { USERS } from ${src('src/data/users.js')};
export { EVENTS } from ${src('src/data/events.js')};
`,
);
const bundle = join(tmp, 'bundle.mjs');
execFileSync(join(root, 'node_modules/.bin/esbuild' + (process.platform === 'win32' ? '.cmd' : '')), [entry, '--bundle', '--platform=node', '--format=esm', `--outfile=${bundle}`, '--log-level=warning'], { shell: process.platform === 'win32' });
const data = await import(pathToFileURL(bundle).href);

const NOW = Date.now();
const DAY = 86400000;
const daysAgo = (iso) => Math.round(((NOW - new Date(iso).getTime()) / DAY) * 100) / 100;
const inDays = (iso) => Math.round(((new Date(iso).getTime() - NOW) / DAY) * 1000) / 1000;
const toSpans = (hours) => Object.fromEntries(Object.entries(hours ?? {}).map(([d, span]) => [d, span ? [span] : []]));

const businesses = data.BUSINESSES.map((b) => ({
  slug: b.slug,
  name: b.name,
  category: b.category,
  tags: b.tags,
  description: b.description,
  coverUrl: b.coverUrl,
  lat: Math.round(b.location.lat * 1e6) / 1e6,
  lng: Math.round(b.location.lng * 1e6) / 1e6,
  township: b.location.township,
  howToFind: b.location.howToFind,
  nearestTaxiRank: b.location.nearestTaxiRank,
  hours: toSpans(b.hours),
  whatsapp: b.whatsapp,
  phone: b.phone,
  website: b.website,
  paymentMethods: b.paymentMethods,
  backupPower: b.backupPower,
  priceLevel: b.priceLevel,
  verificationLevel: b.verificationLevel,
  ownerName: b.ownerName,
  since: b.since,
  offer: b.offers[0]?.title ?? null,
  createdDaysAgo: daysAgo(b.createdAt),
}));

const users = data.USERS.map((u) => ({
  key: u.id,
  displayName: u.name,
  township: u.township,
  accountAgeDays: u.accountAgeDays,
  helpfulVotesReceived: u.helpfulVotesReceived,
  badges: u.badges,
}));

const reviews = Object.values(data.SEED_REVIEWS)
  .flat()
  .map((r) => ({
    business: r.businessId,
    author: r.authorId,
    rating: r.rating,
    subRatings: r.subRatings,
    text: r.text,
    tags: r.tags,
    visited: r.visited,
    helpfulCount: r.helpfulCount,
    edited: r.edited,
    daysAgo: daysAgo(r.createdAt),
    ownerReply: r.ownerReply ? { text: r.ownerReply.text, afterHours: Math.round(((new Date(r.ownerReply.createdAt) - new Date(r.createdAt)) / 3600000) * 10) / 10 } : null,
  }));

const events = data.EVENTS.map((e) => ({
  slug: e.id,
  title: e.title,
  type: e.type,
  description: e.description,
  business: e.businessId,
  host: e.authorId,
  township: e.township,
  venue: e.venue,
  lat: e.lat,
  lng: e.lng,
  startsInDays: inDays(e.startsAt),
  durationHours: Math.round(((new Date(e.endsAt) - new Date(e.startsAt)) / 3600000) * 10) / 10,
  priceRand: e.price,
  capacity: e.capacity,
  rsvpCount: e.attendees,
}));

for (const [name, rows] of Object.entries({ businesses, users, reviews, events })) {
  writeFileSync(join(out, `${name}.json`), `${JSON.stringify(rows, null, 1)}\n`);
  console.log(`${name}.json: ${rows.length}`);
}
rmSync(tmp, { recursive: true, force: true });
