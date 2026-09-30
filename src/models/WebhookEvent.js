import mongoose from 'mongoose';

const { Schema } = mongoose;

/** Clerk (svix) deliveries already handled, so retried webhooks are ignored. Expires after 30 days. */
const webhookEventSchema = new Schema(
  {
    source: { type: String, required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    processedAt: { type: Date, default: () => new Date() },
  },
  { versionKey: false },
);
webhookEventSchema.index({ source: 1, eventId: 1 }, { unique: true });
webhookEventSchema.index({ processedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
export const WebhookEvent = mongoose.model('WebhookEvent', webhookEventSchema);
