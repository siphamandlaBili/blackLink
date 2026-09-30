import mongoose from 'mongoose';
import { REVIEW_STATUSES, REVIEW_TAGS } from '../config/constants.js';
import { baseOptions, mediaSchema } from './shared.js';

const { Schema } = mongoose;

/**
 * @typedef {Object} ReviewDoc
 * @property {import('mongoose').Types.ObjectId} businessId
 * @property {import('mongoose').Types.ObjectId|null} authorId  Null once the author deleted their account ("Former member").
 * @property {number} rating 1–5
 * @property {{ service?: number, quality?: number, value?: number, reliability?: number }} subRatings
 * @property {string} text 20–1000 chars
 * @property {string[]} tags
 * @property {Array<{ url: string, publicId: string|null }>} photos  Up to 3.
 * @property {boolean} visited  Server-set: author was within 150 m when reviewing. Coordinates are never stored.
 * @property {number} helpfulCount
 * @property {'published'|'flagged'|'removed'} status
 * @property {{ text: string, createdAt: Date, updatedAt: Date }|null} ownerReply
 * @property {boolean} edited
 * @property {string} textHash  Normalised-text hash for near-duplicate detection. Internal.
 */
const sub = { type: Number, min: 1, max: 5 };

const reviewSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rating: { type: Number, required: true, min: 1, max: 5 },
    subRatings: { service: sub, quality: sub, value: sub, reliability: sub },
    text: { type: String, required: true, trim: true, minlength: 20, maxlength: 1000 },
    tags: { type: [{ type: String, enum: REVIEW_TAGS }], default: [] },
    photos: { type: [mediaSchema], default: [], validate: (v) => v.length <= 3 },
    visited: { type: Boolean, default: false },
    helpfulCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: REVIEW_STATUSES, default: 'published' },
    ownerReply: {
      type: new Schema(
        { text: { type: String, required: true, maxlength: 1000 }, createdAt: Date, updatedAt: Date },
        { _id: false },
      ),
      default: null,
    },
    edited: { type: Boolean, default: false },
    textHash: { type: String, default: null, select: false },
    // Kept after an author deletes their account, so the review reads "Former member".
    formerMember: { type: Boolean, default: false },
  },
  baseOptions,
);

// One review per author per business. Anonymised reviews (authorId null) are exempt.
reviewSchema.index(
  { businessId: 1, authorId: 1 },
  { unique: true, partialFilterExpression: { authorId: { $type: 'objectId' } } },
);
// Profile review list and its sorts.
reviewSchema.index({ businessId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ businessId: 1, status: 1, helpfulCount: -1 });
reviewSchema.index({ businessId: 1, status: 1, rating: -1 });
// "Reviews written" on a profile, and the 5-per-day limit.
reviewSchema.index({ authorId: 1, createdAt: -1 });
// Burst detection and near-duplicate detection.
reviewSchema.index({ businessId: 1, createdAt: -1 });
reviewSchema.index({ textHash: 1 });
// Landing activity feed.
reviewSchema.index({ status: 1, createdAt: -1 });

export const Review = mongoose.model('Review', reviewSchema);
