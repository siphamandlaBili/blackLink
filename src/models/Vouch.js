import mongoose from 'mongoose';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

/** Community vouches. Three from different members upgrade a business to "vouched". */
const vouchSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  },
  baseOptions,
);
vouchSchema.index({ businessId: 1, userId: 1 }, { unique: true });
export const Vouch = mongoose.model('Vouch', vouchSchema);
