// Seeds the database with Soweto demo data: users, 44 businesses, reviews with owner
// replies and "Visited" flags, offers, events, posts and heritage sites, then computes
// review stats and Trust Scores for every business.
//
// Idempotent: everything is upserted on a natural key, so running it twice changes nothing.
//   npm run seed          upsert
//   npm run seed:reset    wipe every collection first
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { ALL_MODELS, Business, Event, HeritageSite, Offer, Post, Review, User, syncIndexes } from '../src/models/index.js';
import { textHash } from '../src/services/moderation.js';
import { weeklyRanges } from '../src/services/openNow.js';
import { computeReviewStats } from '../src/services/reviewStats.js';
import { computeTrustScore, reviewerCredibility } from '../src/services/trustScore.js';
import { insideSoweto, toPoint } from '../src/utils/geo.js';
import { logger } from '../src/utils/logger.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(here, 'seed-data', `${name}.json`), 'utf8'));
const NOW = Date.now();
const DAY = 86400000;
const ago = (days) => new Date(NOW - days * DAY);
// Demo accounts use the reserved .test domain, so no real inbox can ever receive mail.
const seedEmail = (local) => `${local}@seed.blacklink.test`;
const noTimestamps = { timestamps: false };

/** Upserts many documents on `filterOf(row)` in one round trip. */
async function upsertAll(Model, rows, filterOf) {
  if (!rows.length) return;
  await Model.bulkWrite(
    rows.map((doc) => ({ updateOne: { filter: filterOf(doc), update: { $set: doc }, upsert: true, ...noTimestamps } })),
    { ordered: false },
  );
}

async function seedUsers(reviewers, businesses) {
  const people = reviewers.map((u) => {
    const [firstName, initial = ''] = u.displayName.split(' ');
    return {
      email: seedEmail(u.key),
      clerkId: null,
      emailVerified: true,
      firstName,
      lastName: initial.replace('.', ''),
      displayName: u.displayName,
      role: 'customer',
      badges: u.badges,
      helpfulVotesReceived: u.helpfulVotesReceived,
      area: { township: u.township },
      status: 'active',
      createdAt: ago(u.accountAgeDays),
      updatedAt: ago(0),
    };
  });
  const owners = businesses.map((b) => {
    const [firstName, ...rest] = b.ownerName.replace(/^Dr\s+/, '').split(' ');
    const lastName = rest.join(' ');
    return {
      email: seedEmail(`owner.${b.slug}`),
      clerkId: null,
      emailVerified: true,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName ? `${lastName[0]}.` : ''}`.trim(),
      role: 'owner',
      status: 'active',
      createdAt: ago(b.createdDaysAgo + 1),
      updatedAt: ago(0),
    };
  });
  const admin = {
    email: seedEmail('admin'),
    clerkId: null,
    emailVerified: true,
    firstName: 'Black Link',
    lastName: 'Team',
    displayName: 'Black Link Team',
    role: 'admin',
    status: 'active',
    createdAt: ago(900),
    updatedAt: ago(0),
  };
  await upsertAll(User, [...people, ...owners, admin], (d) => ({ email: d.email }));
  const all = await User.find({ email: { $regex: /@seed\.blacklink\.test$/ } }).lean();
  const byEmail = new Map(all.map((u) => [u.email, u]));
  return {
    reviewer: (key) => byEmail.get(seedEmail(key)),
    owner: (slug) => byEmail.get(seedEmail(`owner.${slug}`)),
    admin: byEmail.get(seedEmail('admin')),
    byId: new Map(all.map((u) => [String(u._id), u])),
  };
}

async function seedBusinesses(rows, users) {
  const docs = rows.map((b) => {
    if (!insideSoweto(b)) throw new Error(`${b.slug} is outside Soweto: ${b.lat}, ${b.lng}`);
    return {
      ownerId: users.owner(b.slug)._id,
      name: b.name,
      nameLower: b.name.toLowerCase(),
      slug: b.slug,
      category: b.category,
      tags: b.tags,
      description: b.description,
      cover: b.coverUrl ? { url: b.coverUrl, publicId: null } : null,
      location: toPoint(b.lat, b.lng),
      township: b.township,
      howToFind: b.howToFind,
      nearestTaxiRank: b.nearestTaxiRank,
      hours: b.hours,
      openRanges: weeklyRanges(b.hours),
      whatsapp: b.whatsapp,
      phone: b.phone,
      website: b.website,
      paymentMethods: b.paymentMethods,
      backupPower: b.backupPower,
      priceLevel: b.priceLevel,
      ownerName: b.ownerName,
      since: b.since,
      verification: { level: b.verificationLevel, cipcStatus: b.verificationLevel === 'registered' ? 'verified' : 'none', vouchCount: b.verificationLevel === 'phone' ? 0 : 3 },
      status: 'published',
      onboardingStep: 8,
      publishedAt: ago(b.createdDaysAgo),
      createdAt: ago(b.createdDaysAgo),
      updatedAt: ago(0),
    };
  });
  await upsertAll(Business, docs, (d) => ({ slug: d.slug }));
  const saved = await Business.find({ slug: { $in: rows.map((r) => r.slug) } }, { slug: 1 }).lean();
  return new Map(saved.map((b) => [b.slug, b._id]));
}

async function seedReviews(rows, users, businessIds) {
  const docs = rows.map((r) => {
    const createdAt = ago(r.daysAgo);
    const replyAt = r.ownerReply ? new Date(createdAt.getTime() + r.ownerReply.afterHours * 3600000) : null;
    return {
      businessId: businessIds.get(r.business),
      authorId: users.reviewer(r.author)._id,
      rating: r.rating,
      subRatings: r.subRatings ?? {},
      text: r.text,
      textHash: textHash(r.text),
      tags: r.tags,
      visited: r.visited,
      helpfulCount: r.helpfulCount,
      status: 'published',
      edited: r.edited,
      ownerReply: r.ownerReply ? { text: r.ownerReply.text, createdAt: replyAt, updatedAt: replyAt } : null,
      createdAt,
      updatedAt: replyAt && replyAt > createdAt ? replyAt : createdAt,
    };
  });
  await upsertAll(Review, docs, (d) => ({ businessId: d.businessId, authorId: d.authorId }));
}

async function seedOffers(rows, businessIds) {
  const docs = rows
    .filter((b) => b.offer)
    .map((b) => {
      const price = /R\s?([\d\s]+)/.exec(b.offer);
      return {
        businessId: businessIds.get(b.slug),
        title: b.offer.slice(0, 80),
        priceCents: price ? Number(price[1].replace(/\s/g, '')) * 100 : null,
        startsAt: ago(3),
        endsAt: ago(-21),
        status: 'active',
        createdAt: ago(3),
        updatedAt: ago(3),
      };
    });
  await upsertAll(Offer, docs, (d) => ({ businessId: d.businessId, title: d.title }));
  await Business.updateMany({}, { $set: { hasActiveOffer: false } }, noTimestamps);
  await Business.updateMany({ _id: { $in: docs.map((d) => d.businessId) } }, { $set: { hasActiveOffer: true } }, noTimestamps);
}

async function seedEvents(rows, users, businessIds) {
  const docs = rows.map((e) => {
    const startsAt = new Date(NOW + e.startsInDays * DAY);
    const host = e.business ? users.owner(e.business) : users.reviewer(e.host);
    return {
      hostId: host._id,
      businessId: e.business ? businessIds.get(e.business) : null,
      title: e.title,
      slug: e.slug,
      type: e.type,
      description: e.description,
      location: toPoint(e.lat, e.lng),
      venue: e.venue,
      township: e.township,
      startsAt,
      endsAt: new Date(startsAt.getTime() + e.durationHours * 3600000),
      priceCents: Math.round(e.priceRand * 100),
      capacity: e.capacity,
      rsvpCount: e.rsvpCount,
      status: 'scheduled',
    };
  });
  await upsertAll(Event, docs, (d) => ({ slug: d.slug }));
}

async function seedPosts(rows, users, businessIds) {
  const docs = rows.map((p) => {
    const author = p.author === 'admin' ? users.admin : p.author === 'owner' ? users.owner(p.business) : users.reviewer(p.author);
    return {
      type: p.type,
      authorId: author._id,
      businessId: p.business ? businessIds.get(p.business) : null,
      title: p.title,
      body: p.body,
      topic: p.topic ?? null,
      lookingFor: p.lookingFor ?? null,
      collabStatus: p.type === 'collab' ? 'open' : null,
      spotlight: p.spotlight ? { from: ago(p.spotlight.fromDaysAgo), to: ago(-p.spotlight.toInDays), story: p.spotlight.story, quote: p.spotlight.quote } : null,
      status: 'published',
      createdAt: ago(p.daysAgo),
      updatedAt: ago(p.daysAgo),
    };
  });
  await upsertAll(Post, docs, (d) => ({ type: d.type, title: d.title }));
}

async function seedHeritage(rows) {
  await upsertAll(
    HeritageSite,
    rows.map((h) => ({ slug: h.slug, name: h.name, description: h.description, township: h.township, location: toPoint(h.lat, h.lng) })),
    (d) => ({ slug: d.slug }),
  );
}

/** Recomputes every business's review stats and Trust Score, and every author's counts and credibility. */
async function recalculate(users) {
  const reviews = await Review.find({ status: 'published' }).lean();
  const platformMean = reviews.reduce((acc, r) => acc + r.rating, 0) / Math.max(1, reviews.length);
  const getAuthor = (id) => (id ? users.byId.get(String(id)) : null);
  const byBusiness = new Map();
  reviews.forEach((r) => byBusiness.set(String(r.businessId), [...(byBusiness.get(String(r.businessId)) ?? []), r]));

  const businesses = await Business.find({ status: 'published' }, { verification: 1 }).lean();
  const ops = businesses.map((b) => {
    const list = byBusiness.get(String(b._id)) ?? [];
    const stats = computeReviewStats(list);
    const trust = computeTrustScore({ reviews: list, verificationLevel: b.verification.level, platformMean, getAuthor, now: NOW });
    return {
      updateOne: {
        filter: { _id: b._id },
        update: {
          $set: {
            'stats.rating': stats.rating,
            'stats.reviewCount': stats.reviewCount,
            'stats.distribution': stats.distribution,
            'stats.subRatings': stats.subRatings,
            'stats.responseRate': trust.responseRate,
            'stats.avgReplyHours': trust.avgReplyHours,
            'stats.followerCount': Math.round(stats.reviewCount * 4.5 + 12),
            'stats.engagement7d': list.filter((r) => NOW - new Date(r.createdAt) < 7 * DAY).length * 10 + stats.reviewCount,
            trust: { score: trust.score, tier: trust.tier, breakdown: trust.breakdown, calculatedAt: new Date(NOW) },
          },
        },
        ...noTimestamps,
      },
    };
  });
  if (ops.length) await Business.bulkWrite(ops, { ordered: false });

  const perAuthor = new Map();
  reviews.forEach((r) => perAuthor.set(String(r.authorId), [...(perAuthor.get(String(r.authorId)) ?? []), r]));
  const userOps = [...perAuthor.entries()].map(([id, list]) => {
    const author = users.byId.get(id);
    const credibility = list.reduce((acc, r) => acc + reviewerCredibility(r, author, NOW), 0) / list.length;
    return { updateOne: { filter: { _id: id }, update: { $set: { reviewCount: list.length, credibility: Math.round(credibility * 100) / 100 } }, ...noTimestamps } };
  });
  if (userOps.length) await User.bulkWrite(userOps, { ordered: false });

  const tiers = await Business.aggregate([{ $match: { status: 'published' } }, { $group: { _id: '$trust.tier', n: { $sum: 1 } } }]);
  return { platformMean: Math.round(platformMean * 100) / 100, tiers: Object.fromEntries(tiers.map((t) => [t._id, t.n])) };
}

async function main() {
  const reset = process.argv.includes('--reset');
  await connectDb();
  if (reset) {
    logger.warn('--reset: wiping every collection');
    await Promise.all(ALL_MODELS.map((m) => m.deleteMany({})));
  }
  await syncIndexes();

  const businesses = load('businesses');
  const users = await seedUsers(load('users'), businesses);
  const businessIds = await seedBusinesses(businesses, users);
  await seedReviews(load('reviews'), users, businessIds);
  await seedOffers(businesses, businessIds);
  await seedEvents(load('events'), users, businessIds);
  await seedPosts(load('posts'), users, businessIds);
  await seedHeritage(load('heritage'));
  const summary = await recalculate(users);

  const counts = Object.fromEntries(await Promise.all(ALL_MODELS.map(async (m) => [m.collection.collectionName, await m.countDocuments()])));
  logger.info({ counts, ...summary }, 'Seed complete');
}

main()
  .catch((err) => {
    logger.fatal({ err }, 'Seed failed');
    process.exitCode = 1;
  })
  .finally(async () => {
    if (mongoose.connection.readyState === 1) await disconnectDb();
  });
