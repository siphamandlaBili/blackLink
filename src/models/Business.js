import mongoose from 'mongoose';
import {
  BUSINESS_STATUSES, CATEGORIES, PAYMENT_METHODS, TOWNSHIPS, TRUST_TIERS, VERIFICATION_LEVELS,
} from '../config/constants.js';
import { weeklyRanges } from '../services/openNow.js';
import { baseOptions, hoursSchema, mediaSchema, pointSchema } from './shared.js';

const { Schema } = mongoose;

/**
 * @typedef {Object} BusinessDoc
 * @property {import('mongoose').Types.ObjectId} _id
 * @property {import('mongoose').Types.ObjectId} ownerId
 * @property {string} name
 * @property {string} nameLower        Lower-cased name for fast case-insensitive prefix search.
 * @property {string} slug
 * @property {string} category
 * @property {string[]} tags
 * @property {string} description
 * @property {{ url: string, publicId: string|null }|null} logo
 * @property {{ url: string, publicId: string|null }|null} cover
 * @property {Array<{ url: string, publicId: string|null }>} gallery
 * @property {{ type: 'Point', coordinates: [number, number] }} location  [lng, lat]
 * @property {string} township
 * @property {Object} hours            See hoursSchema (SAST, spans may cross midnight).
 * @property {string} whatsapp         Digits only, "27…". Public on published listings (it's the contact button).
 * @property {{ level: string, cipcNumber?: string, vouchCount: number }} verification  cipcNumber is private.
 * @property {'draft'|'published'|'suspended'|'deleted'} status
 * @property {{ rating: number, reviewCount: number, distribution: Object, subRatings: Object, responseRate: number, followerCount: number, saveCount: number }} stats
 * @property {{ score: number, tier: string, breakdown: Object, calculatedAt: Date|null }} trust
 */
const serviceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 300 },
    priceCents: { type: Number, default: null, min: 0 }, // ZAR, integer cents
  },
  { _id: true },
);

const businessSchema = new Schema(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Drafts are saved step by step, so name, category, location and township are only
    // required when publishing (enforced in the business service).
    name: { type: String, default: '', trim: true, maxlength: 60 },
    nameLower: { type: String, default: '' },
    slug: { type: String, required: true, lowercase: true, trim: true },
    category: { type: String, enum: CATEGORIES, default: null },
    tags: { type: [String], default: [], validate: (v) => v.length <= 6 },
    description: { type: String, default: '', maxlength: 500 },
    logo: { type: mediaSchema, default: null },
    cover: { type: mediaSchema, default: null },
    gallery: { type: [mediaSchema], default: [], validate: (v) => v.length <= 6 },

    location: { type: pointSchema, default: undefined },
    address: { type: String, default: null, maxlength: 160 },
    township: { type: String, enum: TOWNSHIPS, default: null },
    howToFind: { type: String, default: '', maxlength: 300 },
    nearestTaxiRank: { type: String, default: null, maxlength: 120 },
    serviceRadiusKm: { type: Number, default: null, min: 0, max: 50 },

    hours: { type: hoursSchema, default: () => ({}) },
    // Derived from hours (minute-of-week ranges, SAST) so "open now" is an indexed query.
    // Kept in sync on save; code that updates hours without save() must set it too.
    openRanges: { type: [{ _id: false, s: Number, e: Number }], default: [] },
    whatsapp: { type: String, default: null, match: /^27\d{9}$/ },
    phone: { type: String, default: null, match: /^27\d{9}$/ },
    website: { type: String, default: null, maxlength: 200 },
    socials: { type: Map, of: String, default: {} },
    paymentMethods: { type: [{ type: String, enum: PAYMENT_METHODS }], default: ['cash'] },
    paymentOther: { type: [String], default: [] },
    backupPower: { type: Boolean, default: false },
    priceLevel: { type: Number, min: 1, max: 4, default: 1 },

    ownerName: { type: String, default: '', maxlength: 80 },
    since: { type: Number, default: null, min: 1900, max: 2100 },
    services: { type: [serviceSchema], default: [] },

    verification: {
      level: { type: String, enum: VERIFICATION_LEVELS, default: 'phone' },
      cipcNumber: { type: String, default: null, select: false },
      cipcStatus: { type: String, enum: ['none', 'pending', 'verified', 'rejected'], default: 'none' },
      vouchCount: { type: Number, default: 0, min: 0 },
    },

    status: { type: String, enum: BUSINESS_STATUSES, default: 'draft' },
    onboardingStep: { type: Number, default: 0, min: 0, max: 8 },
    publishedAt: { type: Date, default: null },
    suspendedReason: { type: String, default: null, select: false },
    deletedAt: { type: Date, default: null },

    // Server-computed. Never accepted from clients.
    stats: {
      rating: { type: Number, default: 0 },
      reviewCount: { type: Number, default: 0 },
      distribution: { 1: { type: Number, default: 0 }, 2: { type: Number, default: 0 }, 3: { type: Number, default: 0 }, 4: { type: Number, default: 0 }, 5: { type: Number, default: 0 } },
      subRatings: { service: Number, quality: Number, value: Number, reliability: Number },
      responseRate: { type: Number, default: 0 },
      avgReplyHours: { type: Number, default: null },
      followerCount: { type: Number, default: 0, min: 0 },
      saveCount: { type: Number, default: 0, min: 0 },
      views30d: { type: Number, default: 0 },
      engagement7d: { type: Number, default: 0 },
    },
    trust: {
      score: { type: Number, default: 0, min: 0, max: 100 },
      tier: { type: String, enum: TRUST_TIERS, default: 'building' },
      breakdown: { type: Schema.Types.Mixed, default: {} },
      calculatedAt: { type: Date, default: null },
    },
    hasActiveOffer: { type: Boolean, default: false },
  },
  baseOptions,
);

businessSchema.pre('validate', function derive(next) {
  this.nameLower = (this.name ?? '').toLowerCase();
  if (this.isModified('hours') || this.isNew) this.openRanges = weeklyRanges(this.hours?.toObject?.() ?? this.hours);
  next();
});

businessSchema.index({ slug: 1 }, { unique: true });
businessSchema.index({ location: '2dsphere' });
// Full-text search. Name matters most, then tags, then description.
businessSchema.index(
  { name: 'text', tags: 'text', description: 'text' },
  { weights: { name: 10, tags: 5, description: 1 }, name: 'business_text', default_language: 'english' },
);
// Case-insensitive prefix fallback for short queries ("sak" → Sakhumzi).
businessSchema.index({ status: 1, nameLower: 1 });
// Directory filters and sorts, always scoped to published listings.
businessSchema.index({ status: 1, category: 1, 'trust.score': -1 });
businessSchema.index({ status: 1, township: 1, 'trust.score': -1 });
businessSchema.index({ status: 1, 'stats.rating': -1 });
businessSchema.index({ status: 1, 'trust.score': -1 });
businessSchema.index({ status: 1, publishedAt: -1 });
businessSchema.index({ status: 1, 'stats.engagement7d': -1 });
businessSchema.index({ status: 1, hasActiveOffer: 1 });
businessSchema.index({ ownerId: 1, status: 1 });
businessSchema.index({ status: 1, 'openRanges.s': 1, 'openRanges.e': 1 });

export const Business = mongoose.model('Business', businessSchema);
