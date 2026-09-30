import express, { Router } from 'express';
import { Webhook } from 'svix';
import { env, isTest } from '../config/env.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { WebhookEvent } from '../models/index.js';
import { toIdentity } from '../services/clerk.js';
import { softDeleteByClerkId, upsertFromClerk } from '../services/userService.js';
import { AppError } from '../utils/errors.js';

// Tests sign payloads with this fixed secret (svix format) instead of a real Clerk one.
export const TEST_WEBHOOK_SECRET = 'whsec_dGVzdC13ZWJob29rLXNlY3JldC1ibGFjay1saW5r';
const secret = () => (isTest ? TEST_WEBHOOK_SECRET : env.CLERK_WEBHOOK_SECRET);

const HANDLERS = {
  'user.created': (data) => upsertFromClerk(toIdentity(data)),
  'user.updated': (data) => upsertFromClerk(toIdentity(data)),
  'user.deleted': (data) => (data?.id ? softDeleteByClerkId(data.id) : null),
};

/**
 * POST /api/webhooks/clerk
 *
 * Mounted before express.json(): svix verifies the signature over the exact raw bytes.
 * Idempotent: the svix message id is recorded, so Clerk's retries are acknowledged
 * without being applied twice. Unknown event types are acknowledged and ignored.
 */
const router = Router();
router.post(
  '/',
  express.raw({ type: 'application/json', limit: '100kb' }),
  asyncHandler(async (req, res) => {
    const headers = {
      'svix-id': req.get('svix-id'),
      'svix-timestamp': req.get('svix-timestamp'),
      'svix-signature': req.get('svix-signature'),
    };
    let event;
    try {
      // verify() also rejects stale timestamps (replay protection, 5-minute tolerance).
      event = new Webhook(secret()).verify(req.body, headers);
    } catch {
      throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
    }

    const messageId = headers['svix-id'];
    const seen = await WebhookEvent.findOne({ source: 'clerk', eventId: messageId }).lean();
    if (seen) return res.json({ data: { received: true, duplicate: true } });

    const handler = HANDLERS[event.type];
    if (handler) await handler(event.data);

    // Recorded only after the handler succeeds, so a failure is retried by Clerk.
    await WebhookEvent.updateOne(
      { source: 'clerk', eventId: messageId },
      { $setOnInsert: { type: event.type, processedAt: new Date() } },
      { upsert: true },
    );
    req.log.info({ type: event.type }, 'Clerk webhook processed');
    return res.json({ data: { received: true, handled: Boolean(handler) } });
  }),
);

export default router;
