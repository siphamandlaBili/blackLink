import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Scheduled job runs. (name, key) is unique, e.g. ("weekly-digest", "2026-W40"), so jobs are idempotent. */
const jobRunSchema = new Schema(
  {
    name: { type: String, required: true },
    key: { type: String, required: true },
    status: { type: String, enum: ['running', 'done', 'failed'], default: 'running' },
    startedAt: { type: Date, default: () => new Date() },
    finishedAt: { type: Date, default: null },
    result: { type: Schema.Types.Mixed, default: {} },
  },
  { versionKey: false },
);
jobRunSchema.index({ name: 1, key: 1 }, { unique: true });
jobRunSchema.index({ startedAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });
export const JobRun = mongoose.model('JobRun', jobRunSchema, 'jobRuns');
