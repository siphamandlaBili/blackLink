import mongoose from 'mongoose';
import { CATEGORIES, POST_TYPES } from '../config/constants.js';
import { baseOptions, mediaSchema } from './shared.js';

const { Schema } = mongoose;

const postSchema = new Schema(
  {
    type: { type: String, enum: POST_TYPES, required: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', default: null },
    title: { type: String, default: '', trim: true, maxlength: 120 },
    body: { type: String, required: true, trim: true, maxlength: 2000 },
    media: { type: [mediaSchema], default: [], validate: (v) => v.length <= 4 },
    topic: { type: String, default: null, maxlength: 60 },
    lookingFor: { type: String, enum: [...CATEGORIES, null], default: null },
    collabStatus: { type: String, enum: ['open', 'closed', null], default: null },
    spotlight: {
      type: new Schema({ from: Date, to: Date, story: String, quote: String }, { _id: false }),
      default: null,
    },
    status: { type: String, enum: ['published', 'flagged', 'removed'], default: 'published' },
    commentCount: { type: Number, default: 0, min: 0 },
    reactionCount: { type: Number, default: 0, min: 0 },
  },
  baseOptions,
);
postSchema.index({ status: 1, type: 1, createdAt: -1 });
postSchema.index({ businessId: 1, createdAt: -1 });
postSchema.index({ type: 1, topic: 1, createdAt: -1 });
// "Current Kasi Spotlight" lookup.
postSchema.index({ type: 1, 'spotlight.from': -1 });
export const Post = mongoose.model('Post', postSchema);
