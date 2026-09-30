import mongoose from 'mongoose';
import { REPORT_REASONS, REPORT_STATUSES } from '../config/constants.js';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

/**
 * @typedef {Object} ReportDoc
 * @property {'review'|'business'|'user'|'post'|'comment'} targetType
 * @property {import('mongoose').Types.ObjectId} targetId
 * @property {import('mongoose').Types.ObjectId|null} reporterId  Null for automatic flags.
 * @property {string} reason
 * @property {boolean} auto            True when raised by services/moderation.js.
 * @property {'open'|'kept'|'removed'|'dismissed'} status
 */
const reportSchema = new Schema(
  {
    targetType: { type: String, enum: ['review', 'business', 'user', 'post', 'comment'], required: true },
    targetId: { type: Schema.Types.ObjectId, required: true },
    reporterId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, default: '', maxlength: 500 },
    auto: { type: Boolean, default: false },
    status: { type: String, enum: REPORT_STATUSES, default: 'open' },
    resolvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolvedAt: { type: Date, default: null },
    resolutionNote: { type: String, default: '', maxlength: 500 },
  },
  baseOptions,
);

// Moderation queue: open reports, oldest first.
reportSchema.index({ status: 1, createdAt: 1 });
reportSchema.index({ targetType: 1, targetId: 1, status: 1 });
// A member can report the same thing once.
reportSchema.index(
  { targetType: 1, targetId: 1, reporterId: 1 },
  { unique: true, partialFilterExpression: { reporterId: { $type: 'objectId' } } },
);
// One open automatic flag per target and reason, so re-running moderation doesn't pile up.
reportSchema.index(
  { targetType: 1, targetId: 1, reason: 1 },
  { unique: true, partialFilterExpression: { auto: true, status: 'open' } },
);

export const Report = mongoose.model('Report', reportSchema);
