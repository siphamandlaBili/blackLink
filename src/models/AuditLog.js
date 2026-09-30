import mongoose from 'mongoose';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

/** Every admin action, append-only. */
const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true, maxlength: 60 },
    targetType: { type: String, required: true, maxlength: 30 },
    targetId: { type: Schema.Types.ObjectId, required: true },
    reason: { type: String, default: '', maxlength: 500 },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { ...baseOptions, timestamps: { createdAt: true, updatedAt: false } },
);
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });
export const AuditLog = mongoose.model('AuditLog', auditLogSchema, 'auditLogs');
