import { z } from 'zod';
import { CATEGORIES, DAYS, PAYMENT_METHODS, TOWNSHIPS, VERIFICATION_LEVELS } from '../config/constants.js';
import { normalizeSaPhone } from '../utils/phone.js';
import { mediaRef, objectId, pageQuery } from './common.js';

/*
 * Every schema is .strict(): unknown keys (including "$" operators) are rejected, and
 * server-owned fields (stats, trust, status, verification level, ownerId, slug) simply
 * don't exist here, so a client can't set them.
 */

const csv = (values) =>
  z
    .string()
    .max(500)
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(z.enum(values)).max(values.length));
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const minRating = z.coerce.number().min(0).max(5);
const minTrust = z.coerce.number().int().min(0).max(100);
const priceLevels = z
  .string()
  .max(20)
  .transform((s) => s.split(',').map(Number).filter(Boolean))
  .pipe(z.array(z.number().int().min(1).max(4)).max(4));

/** Filters shared by the directory and Nearby. */
const filters = {
  category: csv(CATEGORIES).optional(),
  township: csv(TOWNSHIPS).optional(),
  minRating: minRating.optional(),
  minTrust: minTrust.optional(),
  price: priceLevels.optional(),
  verification: z.enum(VERIFICATION_LEVELS).optional(), // minimum level
  openNow: bool.optional(),
  newThisMonth: bool.optional(),
  hasOffers: bool.optional(),
  backupPower: bool.optional(),
};

export const LIST_SORTS = ['relevance', 'rated', 'trusted', 'newest', 'popular', 'az'];
export const listQuery = z
  .object({ q: z.string().trim().max(80).optional(), sort: z.enum(LIST_SORTS).optional(), ...filters, ...pageQuery })
  .strict();

export const NEARBY_SORTS = ['best', 'distance', 'rated', 'trusted', 'popular', 'newest'];
export const nearbyQuery = z
  .object({
    lat: z.coerce.number().min(-90).max(90),
    lng: z.coerce.number().min(-180).max(180),
    radiusKm: z.coerce.number().min(0.5).max(20).default(2),
    sort: z.enum(NEARBY_SORTS).default('best'),
    limit: z.coerce.number().int().min(1).max(50).default(50),
    interests: csv(CATEGORIES).optional(),
    ...filters,
  })
  .strict();

export const slugParams = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,100}$/) }).strict();
export const idParams = z.object({ id: objectId }).strict();

// --- Onboarding / editing ---------------------------------------------------------

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'use HH:MM');
const span = z.object({ open: hhmm, close: hhmm }).strict().refine((s) => s.open !== s.close, 'open and close must differ');
const hours = z.object(Object.fromEntries(DAYS.map((d) => [d, z.array(span).max(3)]))).partial().strict();
const phone = z
  .string()
  .max(20)
  .transform((v, ctx) => {
    const n = normalizeSaPhone(v);
    if (!n) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'enter a valid South African number' });
    return n;
  });
const url = z.string().trim().max(200).url().refine((u) => /^https?:\/\//i.test(u), 'must start with http(s)://');

/**
 * PATCH /businesses/:id — any subset of wizard fields, plus the step reached.
 * Nullable where the owner may clear a value.
 */
export const businessPatch = z
  .object({
    onboardingStep: z.number().int().min(0).max(8),
    name: z.string().trim().min(2).max(60),
    category: z.enum(CATEGORIES),
    tags: z.array(z.string().trim().min(1).max(30)).max(6),
    description: z.string().trim().max(500),
    ownerName: z.string().trim().max(80),
    since: z.number().int().min(1900).max(new Date().getFullYear()).nullable(),
    location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict(),
    township: z.enum(TOWNSHIPS),
    address: z.string().trim().max(160).nullable(),
    howToFind: z.string().trim().max(300),
    nearestTaxiRank: z.string().trim().max(120).nullable(),
    serviceRadiusKm: z.number().min(0).max(50).nullable(),
    hours,
    whatsapp: phone,
    phone: phone.nullable(),
    website: url.nullable(),
    socials: z.record(z.enum(['facebook', 'instagram', 'tiktok', 'x', 'youtube']), url).refine((o) => Object.keys(o).length <= 5),
    paymentMethods: z.array(z.enum(PAYMENT_METHODS)).max(PAYMENT_METHODS.length),
    paymentOther: z.array(z.string().trim().min(1).max(30)).max(5),
    backupPower: z.boolean(),
    priceLevel: z.number().int().min(1).max(4),
    services: z
      .array(z.object({ name: z.string().trim().min(1).max(80), description: z.string().trim().max(300).optional(), priceCents: z.number().int().min(0).max(100000000).nullable().optional() }).strict())
      .max(30),
    // CIPC format: YYYY/NNNNNN/NN. Stored privately; "registered" only after it's checked.
    logo: mediaRef.nullable(),
    cover: mediaRef.nullable(),
    gallery: z.array(mediaRef).max(6),
    cipcNumber: z.string().trim().regex(/^(19|20)\d{2}\/\d{6}\/\d{2}$/, 'use the format 2019/123456/07').nullable(),
  })
  .partial()
  .strict();

/** POST /businesses — a draft can start empty or with any wizard fields. */
export const businessCreate = businessPatch;
