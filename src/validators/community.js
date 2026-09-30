import { z } from 'zod';
import { CATEGORIES, EVENT_TYPES, POST_TYPES, TOWNSHIPS } from '../config/constants.js';
import { mediaRef, objectId, pageQuery } from './common.js';

/* Posts, comments, reactions, events and offers. All .strict(); counters and status are server-owned. */

export const THREAD_TOPICS = ['Tips for new owners', 'Local collabs', 'Suppliers and stock', 'Load-shedding and backup power', 'Marketing on WhatsApp'];
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
const date = z.coerce.date();

// --- Posts ---------------------------------------------------------------------------
const postFields = {
  title: z.string().trim().max(120),
  body: z.string().trim().min(1).max(2000),
  media: z.array(mediaRef).max(4),
};
/**
 * One schema per post type (a discriminated union), so each type only accepts its own
 * fields: an update needs a business, a thread needs a topic, a collab needs a business and
 * what it's looking for, and a spotlight (admins only, checked in the service) needs dates.
 */
export const postCreate = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update'), businessId: objectId, ...postFields, title: postFields.title.optional(), media: postFields.media.optional() }).strict(),
  z.object({ type: z.literal('thread'), topic: z.enum(THREAD_TOPICS), ...postFields, title: z.string().trim().min(3).max(120), media: postFields.media.optional() }).strict(),
  z.object({ type: z.literal('collab'), businessId: objectId, lookingFor: z.enum(CATEGORIES), ...postFields, title: z.string().trim().min(3).max(120), media: postFields.media.optional() }).strict(),
  z
    .object({
      type: z.literal('spotlight'),
      businessId: objectId,
      ...postFields,
      title: z.string().trim().min(3).max(120),
      media: postFields.media.optional(),
      spotlight: z.object({ from: date, to: date, story: z.string().trim().min(20).max(2000), quote: z.string().trim().max(300).optional() }).strict().refine((s) => s.to > s.from, 'end must be after start'),
    })
    .strict(),
]);
export const postPatch = z
  .object({ title: postFields.title, body: postFields.body, media: postFields.media, collabStatus: z.enum(['open', 'closed']) })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'send at least one field');
export const postListQuery = z
  .object({ type: z.enum(POST_TYPES).optional(), topic: z.enum(THREAD_TOPICS).optional(), businessId: objectId.optional(), ...pageQuery })
  .strict();

export const commentCreate = z.object({ body: z.string().trim().min(1).max(1000) }).strict();
export const reactionBody = z.object({ kind: z.enum(['like', 'love', 'fire', 'clap']).default('like') }).strict();

// --- Events --------------------------------------------------------------------------
const eventFields = {
  title: z.string().trim().min(3).max(120),
  type: z.enum(EVENT_TYPES),
  description: z.string().trim().max(2000),
  location: z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict(),
  venue: z.string().trim().min(2).max(160),
  township: z.enum(TOWNSHIPS),
  startsAt: date,
  endsAt: date,
  priceCents: z.number().int().min(0).max(10_000_000),
  capacity: z.number().int().min(1).max(100_000).nullable(),
  businessId: objectId.nullable(),
};
export const eventCreate = z
  .object({ ...eventFields, description: eventFields.description.optional(), priceCents: eventFields.priceCents.default(0), capacity: eventFields.capacity.optional(), businessId: eventFields.businessId.optional() })
  .strict()
  .refine((e) => e.endsAt > e.startsAt, { message: 'end must be after start', path: ['endsAt'] });
export const eventPatch = z
  .object(eventFields)
  .omit({ businessId: true })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'send at least one field');
export const eventListQuery = z
  .object({ from: date.optional(), to: date.optional(), type: z.enum(EVENT_TYPES).optional(), township: z.enum(TOWNSHIPS).optional(), free: bool.optional(), businessId: objectId.optional(), ...pageQuery })
  .strict();
export const eventNearbyQuery = z
  .object({ lat: z.coerce.number().min(-90).max(90), lng: z.coerce.number().min(-180).max(180), radiusKm: z.coerce.number().min(0.5).max(20).default(5), days: z.coerce.number().int().min(1).max(90).default(30), limit: z.coerce.number().int().min(1).max(50).default(20) })
  .strict();
export const slugParams = z.object({ slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,100}$/) }).strict();

// --- Offers --------------------------------------------------------------------------
const offerFields = {
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300),
  priceCents: z.number().int().min(0).max(100_000_000).nullable(),
  startsAt: date,
  endsAt: date.nullable(),
};
export const offerCreate = z
  .object({ ...offerFields, description: offerFields.description.optional(), priceCents: offerFields.priceCents.optional(), startsAt: offerFields.startsAt.optional(), endsAt: offerFields.endsAt.optional() })
  .strict()
  .refine((o) => !o.endsAt || o.endsAt > (o.startsAt ?? new Date()), { message: 'end must be after start', path: ['endsAt'] });
export const offerPatch = z
  .object(offerFields)
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'send at least one field');
export const offerListQuery = z.object({ all: bool.optional() }).strict();
