import mongoose from 'mongoose';
import { EMAIL_STATUSES, NOTIFICATION_TYPES } from '../config/constants.js';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true, maxlength: 140 },
    body: { type: String, default: '', maxlength: 500 },
    link: { type: String, default: null, maxlength: 300 },
    data: { type: Schema.Types.Mixed, default: {} },
    readAt: { type: Date, default: null },
    emailStatus: { type: String, enum: EMAIL_STATUSES, default: 'skipped' },
    emailAttempts: { type: Number, default: 0 },
    emailError: { type: String, default: null, select: false },
    dedupeKey: { type: String, default: null },
  },
  baseOptions,
);
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } });
notificationSchema.index({ emailStatus: 1, updatedAt: 1 });
export const Notification = mongoose.model('Notification', notificationSchema);
