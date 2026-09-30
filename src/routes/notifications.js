import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler as h } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { Notification, User } from '../models/index.js';
import { readUnsubscribeToken } from '../services/unsubscribe.js';
import { notFound } from '../utils/errors.js';
import { afterCursor, pageOf, sortObject } from '../utils/pagination.js';
import { idParams, pageQuery } from '../validators/common.js';

const NEWEST = [['createdAt', -1], ['_id', -1]];
const toPublic = (n) => ({ id: String(n._id), type: n.type, title: n.title, body: n.body, link: n.link, data: n.data ?? {}, read: Boolean(n.readAt), createdAt: n.createdAt });
const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** /api/me/notifications — the signed-in user's own notifications only. */
export const myNotifications = Router();
myNotifications.use(requireAuth);

myNotifications.get(
  '/',
  validate({ query: z.object({ unread: bool.optional(), ...pageQuery }).strict() }),
  h(async (req, res) => {
    const q = req.validatedQuery;
    const filter = { userId: req.user._id, ...(q.unread ? { readAt: null } : {}) };
    const [rows, unreadCount] = await Promise.all([
      Notification.find({ ...filter, ...afterCursor(q.cursor, NEWEST) }).sort(sortObject(NEWEST)).limit(q.limit + 1).lean(),
      Notification.countDocuments({ userId: req.user._id, readAt: null }),
    ]);
    const { items, nextCursor } = pageOf(rows, q.limit, NEWEST);
    res.json({ data: items.map(toPublic), meta: { nextCursor, count: items.length, unreadCount } });
  }),
);

myNotifications.post(
  '/read-all',
  h(async (req, res) => {
    const r = await Notification.updateMany({ userId: req.user._id, readAt: null }, { $set: { readAt: new Date() } });
    res.json({ data: { marked: r.modifiedCount, unreadCount: 0 } });
  }),
);

myNotifications.patch(
  '/:id/read',
  validate({ params: idParams }),
  h(async (req, res) => {
    // Scoped to the owner: someone else's notification id is simply "not found".
    const n = await Notification.findOneAndUpdate({ _id: req.params.id, userId: req.user._id }, { $set: { readAt: new Date() } }, { new: true }).lean();
    if (!n) throw notFound('Notification not found');
    res.json({ data: toPublic(n) });
  }),
);

/**
 * /api/unsubscribe — one-click unsubscribe from an email link (GET) or a mail app's
 * "Unsubscribe" button (POST, RFC 8058). No sign-in: the signed token is the proof.
 */
export const unsubscribe = Router();
const tokenQuery = validate({ query: z.object({ token: z.string().min(10).max(400) }).strict() });
async function turnOff(req) {
  const parsed = readUnsubscribeToken(req.validatedQuery.token);
  if (!parsed) return null;
  await User.updateOne({ _id: parsed.userId, status: 'active' }, { $set: { [`preferences.notifications.${parsed.pref}`]: false } });
  return parsed.pref;
}
unsubscribe.post('/', tokenQuery, h(async (req, res) => {
  const pref = await turnOff(req);
  if (!pref) return res.status(400).json({ error: { code: 'INVALID_TOKEN', message: 'This unsubscribe link is not valid' } });
  return res.json({ data: { unsubscribed: pref } });
}));
unsubscribe.get('/', tokenQuery, h(async (req, res) => {
  const pref = await turnOff(req);
  res.status(pref ? 200 : 400).type('html').send(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Black Link</title>` +
      `<body style="font-family:system-ui,sans-serif;background:#F5F5F4;color:#18181B;padding:40px 16px;text-align:center">` +
      `<h1 style="font-size:20px">${pref ? 'You’re unsubscribed' : 'This link is not valid'}</h1>` +
      `<p style="color:#52525B">${pref ? 'You won’t get these emails any more. You can change this any time in your settings.' : 'Try the link in your latest email, or change your email settings in the app.'}</p></body>`,
  );
}));
