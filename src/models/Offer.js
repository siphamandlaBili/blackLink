import mongoose from 'mongoose';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

/**
 * @typedef {Object} OfferDoc
 * @property {import('mongoose').Types.ObjectId} businessId
 * @property {string} title
 * @property {string} description
 * @property {number|null} priceCents  ZAR integer cents.
 * @property {Date} startsAt
 * @property {Date|null} endsAt        Null = open-ended.
 * @property {'active'|'expired'|'removed'} status  The hourly job flips active → expired.
 */
const offerSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    title: { type: String, required: true, trim: true, maxlength: 80 },
    description: { type: String, default: '', maxlength: 300 },
    priceCents: { type: Number, default: null, min: 0 },
    startsAt: { type: Date, default: () => new Date() },
    endsAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'expired', 'removed'], default: 'active' },
  },
  baseOptions,
);
offerSchema.index({ businessId: 1, status: 1, endsAt: 1 });
// Offer-expiry job: active offers whose end has passed.
offerSchema.index({ status: 1, endsAt: 1 });

export const Offer = mongoose.model('Offer', offerSchema);
