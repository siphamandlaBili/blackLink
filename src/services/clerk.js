import { createClerkClient } from '@clerk/express';
import { env, isTest } from '../config/env.js';

/**
 * Everything the app needs to know about a Clerk user, in one shape whether it came from
 * the Backend API (camelCase) or a webhook payload (snake_case).
 * @typedef {Object} ClerkIdentity
 * @property {string} clerkId
 * @property {string|null} email          Primary email address.
 * @property {boolean} emailVerified      Primary email's verification status is "verified".
 * @property {string} firstName
 * @property {string} lastName
 * @property {string|null} avatarUrl
 */

export const clerk = isTest ? null : createClerkClient({ secretKey: env.CLERK_SECRET_KEY, publishableKey: env.CLERK_PUBLISHABLE_KEY });

/** Normalises a Clerk user object from either source. */
export function toIdentity(u) {
  const emails = u.emailAddresses ?? u.email_addresses ?? [];
  const primaryId = u.primaryEmailAddressId ?? u.primary_email_address_id;
  const primary = emails.find((e) => e.id === primaryId) ?? emails[0];
  return {
    clerkId: u.id,
    email: (primary?.emailAddress ?? primary?.email_address ?? '').toLowerCase() || null,
    emailVerified: primary?.verification?.status === 'verified',
    firstName: (u.firstName ?? u.first_name ?? '').trim(),
    lastName: (u.lastName ?? u.last_name ?? '').trim(),
    avatarUrl: u.imageUrl ?? u.image_url ?? null,
  };
}

// Tests register fake Clerk users here instead of calling Clerk (NODE_ENV=test only).
const testUsers = new Map();
export function registerTestClerkUser(identity) {
  if (!isTest) throw new Error('registerTestClerkUser is only available in tests');
  testUsers.set(identity.clerkId, identity);
}

/**
 * Fetches a user from Clerk's Backend API. Used when a valid token arrives before the
 * user.created webhook has been processed.
 * @param {string} clerkId
 * @returns {Promise<ClerkIdentity|null>}
 */
export async function fetchClerkIdentity(clerkId) {
  if (isTest) return testUsers.get(clerkId) ?? null;
  try {
    return toIdentity(await clerk.users.getUser(clerkId));
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

/** Deletes the Clerk account (POPIA account deletion, Phase 7). */
export async function deleteClerkUser(clerkId) {
  if (isTest) {
    testUsers.delete(clerkId);
    return;
  }
  await clerk.users.deleteUser(clerkId);
}
