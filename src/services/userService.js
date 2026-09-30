import { User } from '../models/index.js';
import { forbidden, notFound } from '../utils/errors.js';
import { roundArea } from '../utils/geo.js';
import { logger } from '../utils/logger.js';
import { displayNameOf } from '../utils/slug.js';
import { fetchClerkIdentity } from './clerk.js';
import { emit } from './events.js';

/**
 * Creates or updates the Mongo user for a Clerk identity. Idempotent, so webhook retries
 * and the on-the-fly path can both call it safely.
 *
 * Only identity fields are written. Role, badges, preferences and counters belong to
 * Black Link and are never overwritten from Clerk.
 *
 * If a live account already uses the email but has no Clerk id (a seeded demo user, or a
 * user created before Clerk), it is linked instead of duplicated.
 *
 * @param {import('./clerk.js').ClerkIdentity} identity
 * @returns {Promise<Object>} The lean user document.
 */
export async function upsertFromClerk(identity) {
  const { clerkId, email, emailVerified, firstName, lastName, avatarUrl } = identity;
  const first = firstName || (email ? email.split('@')[0] : 'Member');
  const identityFields = {
    email: email ?? `${clerkId}@users.noemail.invalid`,
    emailVerified: Boolean(email) && emailVerified,
    firstName: first,
    lastName,
    displayName: displayNameOf(first, lastName),
    avatarUrl,
  };

  const existing = await User.findOne({ clerkId }).lean();
  if (existing?.status === 'deleted') return existing; // never resurrect a deleted account from Clerk data
  if (!existing && email) {
    const unlinked = await User.findOneAndUpdate(
      { email, clerkId: null, status: { $in: ['active', 'suspended'] } },
      { $set: { ...identityFields, clerkId } },
      { new: true },
    ).lean();
    if (unlinked) return unlinked;
  }

  try {
    const res = await User.findOneAndUpdate(
      { clerkId },
      { $set: identityFields, $setOnInsert: { clerkId, role: 'customer', status: 'active' } },
      { new: true, upsert: true, includeResultMetadata: true },
    ).lean();
    // A brand-new account (not an update, not a linked seed account) gets the welcome.
    if (res.lastErrorObject?.upserted) emit('user.created', { user: res.value });
    return res.value;
  } catch (err) {
    // Two requests creating the same user at once: the loser just reads the winner's document.
    if (err?.code === 11000) return User.findOne({ clerkId }).lean();
    throw err;
  }
}

/**
 * Loads the Mongo user for a signed-in Clerk user, creating it on the fly when the
 * user.created webhook hasn't arrived yet.
 * @param {string} clerkId
 */
export async function findOrCreateByClerkId(clerkId) {
  const user = await User.findOne({ clerkId }).lean();
  if (user) return user;
  const identity = await fetchClerkIdentity(clerkId);
  if (!identity) throw notFound('Account not found');
  logger.info('Created user on the fly (webhook not yet processed)');
  return upsertFromClerk(identity);
}

/**
 * Soft delete from Clerk's user.deleted webhook. Personal data is purged by the nightly
 * job after 30 days (Phase 6); reviews are anonymised then too (Phase 7).
 * @returns {Promise<boolean>} Whether a live user was found and marked.
 */
export async function softDeleteByClerkId(clerkId) {
  const result = await User.updateOne(
    { clerkId, status: { $ne: 'deleted' } },
    { $set: { status: 'deleted', deletedAt: new Date() } },
  );
  return result.modifiedCount > 0;
}

/** Throws unless the account can act (not suspended or deleted). */
export function assertActive(user) {
  if (!user || user.status === 'deleted') throw forbidden('This account has been deleted');
  if (user.status === 'suspended') throw forbidden('This account is suspended');
}

/**
 * Updates the signed-in user's own preferences. Only the keys provided change.
 * A remembered area is rounded to ~1 km before it's stored.
 * @param {import('mongoose').Types.ObjectId} userId
 * @param {import('../validators/me.js').PreferencesInput} input
 */
export async function updatePreferences(userId, input) {
  const $set = {};
  const { notifications, area, ...rest } = input;
  for (const [key, value] of Object.entries(rest)) $set[`preferences.${key}`] = value;
  for (const [key, value] of Object.entries(notifications ?? {})) $set[`preferences.notifications.${key}`] = value;
  if (area === null) {
    Object.assign($set, { 'area.township': null, 'area.lat': null, 'area.lng': null });
  } else if (area) {
    const rounded = area.lat != null && area.lng != null ? roundArea(area) : { lat: null, lng: null };
    Object.assign($set, { 'area.township': area.township ?? null, 'area.lat': rounded.lat, 'area.lng': rounded.lng });
  }
  const user = await User.findOneAndUpdate({ _id: userId, status: 'active' }, { $set }, { new: true }).lean();
  if (!user) throw notFound('Account not found');
  return user;
}
