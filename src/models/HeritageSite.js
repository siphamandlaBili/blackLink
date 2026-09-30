import mongoose from 'mongoose';
import { TOWNSHIPS } from '../config/constants.js';
import { baseOptions, mediaSchema, pointSchema } from './shared.js';

const { Schema } = mongoose;

/** @typedef {{ name: string, slug: string, description: string, location: { type: 'Point', coordinates: [number, number] }, township: string }} HeritageSiteDoc */
const heritageSiteSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, lowercase: true },
    description: { type: String, default: '', maxlength: 1000 },
    location: { type: pointSchema, required: true },
    township: { type: String, enum: TOWNSHIPS, required: true },
    image: { type: mediaSchema, default: null },
  },
  baseOptions,
);
heritageSiteSchema.index({ slug: 1 }, { unique: true });
heritageSiteSchema.index({ location: '2dsphere' });

export const HeritageSite = mongoose.model('HeritageSite', heritageSiteSchema);
