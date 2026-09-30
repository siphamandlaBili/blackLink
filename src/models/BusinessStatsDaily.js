import mongoose from 'mongoose';

const { Schema } = mongoose;

/**
 * Per-business daily counters for the dashboard. `date` is the SAST calendar day
 * "YYYY-MM-DD". Updated with $inc + upsert; holds no personal data.
 */
const statsDailySchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    views: { type: Number, default: 0 },
    whatsappClicks: { type: Number, default: 0 },
    callClicks: { type: Number, default: 0 },
    directionsClicks: { type: Number, default: 0 },
    websiteClicks: { type: Number, default: 0 },
  },
  { versionKey: false },
);
statsDailySchema.index({ businessId: 1, date: 1 }, { unique: true });
statsDailySchema.index({ date: 1 });
export const BusinessStatsDaily = mongoose.model('BusinessStatsDaily', statsDailySchema, 'businessStatsDaily');
