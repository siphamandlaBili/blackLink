import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';

/*
 * One-click unsubscribe links. The token names a user and one preference, signed with an
 * HMAC so it can't be forged or pointed at someone else. It doesn't expire: an unsubscribe
 * link in an old email must still work (it can only ever switch emails *off*).
 */
export const EMAIL_PREFS = ['newReview', 'ownerReply', 'eventReminders', 'weeklyDigest', 'product'];

const secret = () => `unsubscribe:${env.JOB_SECRET ?? 'test-only-unsubscribe-secret'}`;
const mac = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function unsubscribeToken(userId, pref) {
  const payload = `${userId}.${pref}`;
  return Buffer.from(`${payload}.${mac(payload)}`).toString('base64url');
}

/** @returns {{ userId: string, pref: string } | null} */
export function readUnsubscribeToken(token) {
  try {
    const [userId, pref, sig] = Buffer.from(String(token), 'base64url').toString('utf8').split('.');
    if (!userId || !EMAIL_PREFS.includes(pref) || !sig) return null;
    const expected = Buffer.from(mac(`${userId}.${pref}`));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { userId, pref };
  } catch {
    return null;
  }
}
