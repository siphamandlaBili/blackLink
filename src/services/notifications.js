import { Notification, User } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { isSendable, renderEmail, sendEmail } from './email.js';

/*
 * Every notification is an in-app record (GET /me/notifications) and, if the user wants
 * it, an email. Rules:
 *  - dedupeKey makes it idempotent: the same event (e.g. "new_review:<id>") never creates
 *    two notifications or sends two emails, even if a job or listener runs twice.
 *  - Email respects the user's notification preferences and never goes to seeded or
 *    placeholder addresses.
 *  - Sending never blocks or fails the request that caused it: it runs in the background,
 *    retries once, and records the outcome in emailStatus.
 */
export const TYPE_PREF = {
  welcome: 'product',
  business_published: 'product',
  report_outcome: 'product',
  new_review: 'newReview',
  owner_reply: 'ownerReply',
  event_reminder: 'eventReminders',
  weekly_digest: 'weeklyDigest',
};
const RETRY_DELAY_MS = 2000;
const inFlight = new Set();

/** Tests: wait for background email deliveries to finish. */
export const settleEmails = () => Promise.allSettled([...inFlight]);

async function deliver(notificationId, user, template, props, pref) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const message = await renderEmail(template, { ...props, firstName: user.firstName }, { userId: String(user._id), pref });
      await sendEmail({ to: user.email, ...message });
      await Notification.updateOne({ _id: notificationId }, { $set: { emailStatus: 'sent', emailAttempts: attempt, emailError: null } });
      return;
    } catch (err) {
      lastError = err;
      if (attempt === 1) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }
  // No address, no body: only the notification type and the error go to the log.
  logger.error({ type: template, reason: lastError?.message }, 'Email failed after retry');
  await Notification.updateOne({ _id: notificationId }, { $set: { emailStatus: 'failed', emailAttempts: 2, emailError: String(lastError?.message ?? '').slice(0, 300) } });
}

/**
 * @param {Object} n
 * @param {string|import('mongoose').Types.ObjectId} n.userId
 * @param {keyof TYPE_PREF} n.type
 * @param {string} n.title
 * @param {string} [n.body]
 * @param {string} [n.link]      App path, e.g. "/business/gogo-catering#reviews".
 * @param {Object} [n.data]
 * @param {string} [n.dedupeKey]
 * @param {{ template: string, props: Object }} [n.email]  Omit for in-app only.
 * @returns {Promise<Object|null>} The notification, or null if skipped (inactive user, duplicate).
 */
export async function notify({ userId, type, title, body = '', link = null, data = {}, dedupeKey = null, email }) {
  const user = await User.findById(userId, { email: 1, firstName: 1, status: 1, preferences: 1 }).lean();
  if (!user || user.status !== 'active') return null;

  const pref = TYPE_PREF[type];
  const wantsEmail = Boolean(email) && user.preferences?.notifications?.[pref] !== false && isSendable(user.email);
  let notification;
  try {
    notification = await Notification.create({ userId, type, title, body, link, data, dedupeKey, emailStatus: wantsEmail ? 'pending' : 'skipped' });
  } catch (err) {
    if (err?.code === 11000) return null; // already notified about this exact event
    throw err;
  }
  if (wantsEmail) {
    const task = deliver(notification._id, user, email.template, email.props, pref).finally(() => inFlight.delete(task));
    inFlight.add(task);
  }
  return notification.toObject();
}
