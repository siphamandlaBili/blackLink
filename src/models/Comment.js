import mongoose from 'mongoose';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

const commentSchema = new Schema(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['published', 'flagged', 'removed'], default: 'published' },
  },
  baseOptions,
);
commentSchema.index({ postId: 1, status: 1, createdAt: 1 });
commentSchema.index({ authorId: 1, createdAt: -1 });
export const Comment = mongoose.model('Comment', commentSchema);
