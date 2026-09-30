import mongoose from 'mongoose';
import { DAYS } from '../config/constants.js';

const { Schema } = mongoose;

/** GeoJSON point. Coordinates are [lng, lat] (GeoJSON order), which `2dsphere` requires. */
export const pointSchema = new Schema(
  {
    type: { type: String, enum: ['Point'], default: 'Point', required: true },
    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: ([lng, lat] = []) => lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90,
        message: 'coordinates must be [lng, lat]',
      },
    },
  },
  { _id: false },
);

/** An uploaded image: Cloudinary URL plus its public id so it can be deleted later. */
export const mediaSchema = new Schema(
  { url: { type: String, required: true }, publicId: { type: String, default: null }, width: Number, height: Number },
  { _id: false },
);

/**
 * Opening hours: per weekday a list of spans "HH:MM"-"HH:MM" in Africa/Johannesburg time.
 * A span may cross midnight (close < open, e.g. 18:00–02:00). Empty list = closed that day.
 */
const spanSchema = new Schema(
  {
    open: { type: String, required: true, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    close: { type: String, required: true, match: /^([01]\d|2[0-4]):[0-5]\d$/ },
  },
  { _id: false },
);
export const hoursSchema = new Schema(
  Object.fromEntries(DAYS.map((d) => [d, { type: [spanSchema], default: [] }])),
  { _id: false },
);

/** Standard options: timestamps, no __v, ids as strings in JSON. */
export const baseOptions = {
  timestamps: true,
  versionKey: false,
  toJSON: { virtuals: true },
};
