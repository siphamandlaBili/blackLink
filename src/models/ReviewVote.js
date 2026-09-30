import mongoose from 'mongoose';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

/** "Helpful" votes on reviews. */
const reviewVoteSchema = new Schema(
  {
    reviewId: { type: Schema.Types.ObjectId, ref: 'Review', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  baseOptions,
);
reviewVoteSchema.index({ reviewId: 1, userId: 1 }, { unique: true });
reviewVoteSchema.index({ userId: 1 });
export const ReviewVote = mongoose.model('ReviewVote', reviewVoteSchema);
