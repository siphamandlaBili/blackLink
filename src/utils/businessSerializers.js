import { thumbnailUrl } from '../services/cloudinary.js';
import { openStatus } from '../services/openNow.js';
import { fromPoint } from './geo.js';

/*
 * Business response shapes. Fields are copied by name (allowlist), so private and
 * internal fields (ownerId, verification.cipcNumber, openRanges, nameLower, suspendedReason,
 * deletedAt) can never leak. Computed values (open status, "new") are always
 * calculated here on the server, never taken from the client.
 */

const NEW_DAYS = 30;
const id = (v) => (v ? String(v) : null);
const imageUrl = (m) => m?.url ?? null;
// Cloudinary images get the 640px eager thumbnail; seeded local images are already small.
const thumbUrl = (m) => (m?.publicId ? thumbnailUrl(m.publicId) : (m?.url ?? null));

/** "Building trust" hides the number, so new businesses aren't judged on a thin record. */
const trustOf = (b) => ({ score: b.trust?.tier === 'building' ? null : (b.trust?.score ?? 0), tier: b.trust?.tier ?? 'building' });

/**
 * List card (Explore, Nearby, landing).
 * @param {Object} b     Lean business document.
 * @param {{ now?: Date, viewer?: { following: boolean } }} [opts]
 */
export function businessToCard(b, { now = new Date(), viewer } = {}) {
  const card = {
    id: id(b._id),
    slug: b.slug,
    name: b.name,
    category: b.category,
    tags: b.tags ?? [],
    description: b.description ?? '',
    coverUrl: imageUrl(b.cover),
    coverThumbUrl: thumbUrl(b.cover),
    logoUrl: imageUrl(b.logo),
    township: b.township,
    location: fromPoint(b.location),
    priceLevel: b.priceLevel,
    verificationLevel: b.verification?.level ?? 'phone',
    rating: b.stats?.rating ?? 0,
    reviewCount: b.stats?.reviewCount ?? 0,
    trust: trustOf(b),
    hasActiveOffer: Boolean(b.hasActiveOffer),
    backupPower: Boolean(b.backupPower),
    isNew: Boolean(b.publishedAt) && now - new Date(b.publishedAt) < NEW_DAYS * 86400000,
    openStatus: openStatus(b.hours, now),
    publishedAt: b.publishedAt ?? null,
  };
  if (typeof b.distanceM === 'number') card.distanceM = Math.round(b.distanceM);
  if (viewer) card.viewer = viewer;
  return card;
}

/**
 * Full public profile.
 * @param {Object} b
 * @param {{ offers?: Array<Object>, viewer?: Object, now?: Date }} [opts]
 */
export function businessToProfile(b, { offers = [], viewer, now = new Date() } = {}) {
  return {
    ...businessToCard(b, { now }),
    gallery: (b.gallery ?? []).filter((m) => m?.url).map((m) => ({ url: m.url, thumbUrl: thumbUrl(m), width: m.width ?? null, height: m.height ?? null })),
    address: b.address ?? null,
    howToFind: b.howToFind ?? '',
    nearestTaxiRank: b.nearestTaxiRank ?? null,
    serviceRadiusKm: b.serviceRadiusKm ?? null,
    hours: b.hours ?? {},
    // Business contact details are public on a published listing: they are the point of it.
    whatsapp: b.whatsapp ?? null,
    phone: b.phone ?? null,
    website: b.website ?? null,
    socials: b.socials ? Object.fromEntries(b.socials instanceof Map ? b.socials : Object.entries(b.socials)) : {},
    paymentMethods: b.paymentMethods ?? [],
    paymentOther: b.paymentOther ?? [],
    ownerName: b.ownerName ?? '',
    since: b.since ?? null,
    services: (b.services ?? []).map((s) => ({ id: id(s._id), name: s.name, description: s.description ?? '', priceCents: s.priceCents ?? null })),
    offers: offers.map((o) => ({ id: id(o._id), title: o.title, description: o.description ?? '', priceCents: o.priceCents ?? null, endsAt: o.endsAt ?? null })),
    stats: {
      distribution: b.stats?.distribution ?? {},
      subRatings: b.stats?.subRatings ?? {},
      responseRate: b.stats?.responseRate ?? 0,
      followerCount: b.stats?.followerCount ?? 0,
    },
    trust: { ...trustOf(b), breakdown: b.trust?.breakdown ?? {}, calculatedAt: b.trust?.calculatedAt ?? null },
    vouchCount: b.verification?.vouchCount ?? 0,
    ...(viewer ? { viewer } : {}),
  };
}

/**
 * What the owner sees while onboarding or editing: the profile plus draft state.
 * The CIPC number is the owner's own data, so it's shown to them (and only them), masked.
 */
export function businessToOwner(b, opts = {}) {
  const cipc = b.verification?.cipcNumber;
  return {
    ...businessToProfile(b, opts),
    status: b.status,
    onboardingStep: b.onboardingStep ?? 0,
    verification: {
      level: b.verification?.level ?? 'phone',
      cipcStatus: b.verification?.cipcStatus ?? 'none',
      cipcNumber: cipc ? `${cipc.slice(0, 4)}/******/${cipc.slice(-2)}` : null,
      vouchCount: b.verification?.vouchCount ?? 0,
    },
    // Photo ids let the owner's wizard resume a draft and keep the same images.
    media: {
      logo: b.logo?.publicId ? { publicId: b.logo.publicId, url: b.logo.url } : null,
      cover: b.cover?.publicId ? { publicId: b.cover.publicId, url: b.cover.url } : null,
      gallery: (b.gallery ?? []).filter((g) => g?.publicId).map((g) => ({ publicId: g.publicId, url: g.url })),
    },
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}
