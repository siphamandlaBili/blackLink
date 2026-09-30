import { z } from 'zod';
import { REVIEW_TAGS } from '../config/constants.js';
import { mediaRef, objectId, pageQuery } from './common.js';

/*
 * .strict() everywhere. Server-owned review fields (visited, helpfulCount, status,
 * ownerReply, edited, authorId) don't exist in these schemas, so they can't be sent.
 */
const star = z.number().int().min(1).max(5);
const subRatings = z.object({ service: star, quality: star, value: star, reliability: star }).partial().strict();
const tags = z.array(z.enum(REVIEW_TAGS)).max(REVIEW_TAGS.length).refine((t) => new Set(t).size === t.length, 'duplicate tag');
// The reviewer's current position, used once for the "Visited" check and then discarded.
const location = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).strict();
const text = z.string().trim().min(20, 'write at least 20 characters').max(1000, 'keep it under 1000 characters');

const photos = z.array(mediaRef).max(3);

export const reviewCreate = z.object({ rating: star, subRatings: subRatings.optional(), text, tags: tags.optional(), photos: photos.optional(), location: location.optional() }).strict();

export const reviewPatch = z
  .object({ rating: star, subRatings, text, tags, photos, location })
  .partial()
  .strict()
  .refine((b) => ['rating', 'subRatings', 'text', 'tags', 'photos'].some((k) => k in b), 'send at least one field to change');

export const replyBody = z.object({ text: z.string().trim().min(1).max(1000) }).strict();

export const USER_REPORT_REASONS = ['fake', 'offensive', 'spam', 'conflict_of_interest', 'not_real_experience'];
export const reportBody = z.object({ reason: z.enum(USER_REPORT_REASONS), details: z.string().trim().max(500).optional() }).strict();

export const REVIEW_SORTS = ['helpful', 'newest', 'highest', 'lowest'];
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');
export const reviewListQuery = z
  .object({
    stars: z
      .string()
      .max(20)
      .transform((s) => s.split(',').map(Number))
      .pipe(z.array(z.number().int().min(1).max(5)).max(5))
      .optional(),
    withPhotos: bool.optional(),
    visited: bool.optional(),
    sort: z.enum(REVIEW_SORTS).default('helpful'),
    ...pageQuery,
  })
  .strict();

export const businessIdParams = z.object({ id: objectId }).strict();
export const reviewIdParams = z.object({ id: objectId }).strict();
