import { z } from 'zod';
import { CATEGORIES, TOWNSHIPS } from '../config/constants.js';

/**
 * PATCH /api/me/preferences. Every key is optional; only what's sent changes.
 * .strict() everywhere: unknown keys (and "$"-prefixed ones) are rejected, and fields the
 * server owns (role, badges, reviewCount …) can't be smuggled in.
 */
const notifications = z
  .object({
    newReview: z.boolean(),
    ownerReply: z.boolean(),
    eventReminders: z.boolean(),
    weeklyDigest: z.boolean(),
    product: z.boolean(),
  })
  .partial()
  .strict();

// A remembered area: a township, and optionally coordinates (rounded to ~1 km server-side).
const area = z
  .object({
    township: z.enum(TOWNSHIPS).nullable().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
  })
  .strict()
  .refine((a) => (a.lat == null) === (a.lng == null), 'send lat and lng together');

export const preferencesBody = z
  .object({
    categories: z.array(z.enum(CATEGORIES)).max(CATEGORIES.length).refine((a) => new Set(a).size === a.length, 'duplicate category'),
    radiusKm: z.number().min(0.5).max(20),
    language: z.enum(['en', 'zu', 'st', 'tn', 'xh']),
    notifications,
    area: area.nullable(),
  })
  .partial()
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'send at least one preference');

/** @typedef {z.infer<typeof preferencesBody>} PreferencesInput */
