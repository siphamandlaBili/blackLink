import mongoose from 'mongoose';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

/** Saved ("bookmarked") businesses. Private to the user. */
const saveSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  },
  baseOptions,
);
saveSchema.index({ userId: 1, businessId: 1 }, { unique: true });
saveSchema.index({ userId: 1, createdAt: -1 });
export const Save = mongoose.model('Save', saveSchema);
