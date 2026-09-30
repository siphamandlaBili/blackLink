import mongoose from 'mongoose';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

/** @typedef {{ userId: import('mongoose').Types.ObjectId, businessId: import('mongoose').Types.ObjectId }} FollowDoc */
const followSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  },
  baseOptions,
);
followSchema.index({ userId: 1, businessId: 1 }, { unique: true });
followSchema.index({ businessId: 1, createdAt: -1 });
export const Follow = mongoose.model('Follow', followSchema);
