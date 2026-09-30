import { createHash } from 'node:crypto';
import { Business, BusinessStatsDaily } from '../models/index.js';
import { notFound } from '../utils/errors.js';
import { sastDay } from '../jobs/trustRefresh.js';

/*
 * Anonymous engagement counters for the owner dashboard. Nothing personal is stored: the
 * database only ever sees per-business, per-day totals. To stop one visitor refreshing a
 * page from inflating views, a short-lived in-memory set remembers a salted hash of
 * (IP, business) for 30 minutes. It never touches disk or the database, and the salt
 * rotates daily, so hashes can't be linked across days.
 */
export const TRACK_EVENTS = { view: 'views', whatsapp: 'whatsappClicks', call: 'callClicks', directions: 'directionsClicks', website: 'websiteClicks' };
const VIEW_WINDOW_MS = 30 * 60 * 1000;
const recentViews = new Map(); // hash -> expiry time

let salt = { day: null, value: '' };
function hashOf(ip, businessId, now) {
  const day = sastDay(now);
  if (salt.day !== day) salt = { day, value: createHash('sha256').update(`${day}:${Math.random()}`).digest('hex') };
  return createHash('sha256').update(`${salt.value}:${ip}:${businessId}`).digest('base64url');
}

function seenRecently(key, now) {
  const until = recentViews.get(key);
  if (until && until > now.getTime()) return true;
  recentViews.set(key, now.getTime() + VIEW_WINDOW_MS);
  // Keep the set small: drop expired entries now and then.
  if (recentViews.size > 50000) for (const [k, t] of recentViews) if (t <= now.getTime()) recentViews.delete(k);
  return false;
}

/**
 * Counts one event for a published business. Returns whether it was counted.
 * Owners viewing their own listing aren't counted, and a repeat view from the same visitor
 * within 30 minutes counts once. Clicks always count (the per-business rate limit bounds them).
 */
export async function track({ businessId, event }, { ip, user, now = new Date() }) {
  const business = await Business.findOne({ _id: businessId, status: 'published' }, { ownerId: 1 }).lean();
  if (!business) throw notFound('Business not found');
  if (user && String(user._id) === String(business.ownerId)) return { counted: false, reason: 'owner' };
  if (event === 'view' && seenRecently(hashOf(ip, businessId, now), now)) return { counted: false, reason: 'repeat' };
  await BusinessStatsDaily.updateOne(
    { businessId, date: sastDay(now) },
    { $inc: { [TRACK_EVENTS[event]]: 1 } },
    { upsert: true },
  );
  return { counted: true };
}
