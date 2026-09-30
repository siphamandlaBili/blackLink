import mongoose from 'mongoose';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

/** "I'm going". reminderSentAt keeps the reminder job idempotent. */
const rsvpSchema = new Schema(
  {
    eventId: { type: Schema.Types.ObjectId, ref: 'Event', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reminderSentAt: { type: Date, default: null },
  },
  baseOptions,
);
rsvpSchema.index({ eventId: 1, userId: 1 }, { unique: true });
rsvpSchema.index({ userId: 1, createdAt: -1 });
rsvpSchema.index({ eventId: 1, reminderSentAt: 1 });
export const Rsvp = mongoose.model('Rsvp', rsvpSchema);
