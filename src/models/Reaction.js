import mongoose from 'mongoose';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

const reactionSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    kind: { type: String, enum: ['like', 'love', 'fire', 'clap'], default: 'like' },
  },
  baseOptions,
);
reactionSchema.index({ postId: 1, userId: 1 }, { unique: true });
export const Reaction = mongoose.model('Reaction', reactionSchema);
