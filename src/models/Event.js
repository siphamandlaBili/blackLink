import mongoose from 'mongoose';
import { EVENT_TYPES, TOWNSHIPS } from '../config/constants.js';
import { baseOptions, pointSchema } from './shared.js';

const { Schema } = mongoose;

const eventSchema = new Schema(
  {
    hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', default: null },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true },
    type: { type: String, enum: EVENT_TYPES, required: true },
    description: { type: String, default: '', maxlength: 2000 },
    location: { type: pointSchema, required: true },
    venue: { type: String, required: true, maxlength: 160 },
    township: { type: String, enum: TOWNSHIPS, required: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    priceCents: { type: Number, default: 0, min: 0 },
    capacity: { type: Number, default: null, min: 1 },
    rsvpCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['scheduled', 'cancelled', 'removed'], default: 'scheduled' },
  },
  baseOptions,
);
eventSchema.index({ slug: 1 }, { unique: true });
eventSchema.index({ location: '2dsphere' });
eventSchema.index({ status: 1, startsAt: 1 });
eventSchema.index({ status: 1, township: 1, startsAt: 1 });
eventSchema.index({ businessId: 1, startsAt: -1 });
eventSchema.index({ hostId: 1, startsAt: -1 });
export const Event = mongoose.model('Event', eventSchema);
