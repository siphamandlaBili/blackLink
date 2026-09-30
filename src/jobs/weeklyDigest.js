import { env } from '../config/env.js';
import { Business, Event, User } from '../models/index.js';
import { notify } from '../services/notifications.js';
import { getTrending } from '../services/publicService.js';

/** ISO week, e.g. "2026-W40". The digest runs once per week (Mondays 08:00 SAST). */
export function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7)).padStart(2, '0')}`;
}

const BATCH = 200;

/**
 * Weekly. One digest per opted-in member: new businesses from the last 7 days, events in
 * the next 7, and what's trending. The content is built once; only the greeting differs.
 * dedupeKey "weekly_digest:<week>:<user>" makes a second run in the same week a no-op.
 */
export const weeklyDigest = {
  name: 'weekly-digest',
  key: (now) => isoWeek(now),
  async run(now) {
    const week = isoWeek(now);
    const url = (p) => `${env.CLIENT_URL}${p}`;
    const [fresh, events, trending] = await Promise.all([
      Business.find({ status: 'published', publishedAt: { $gte: new Date(now - 7 * 86400000) } }, { name: 1, slug: 1, category: 1, township: 1 }).sort({ publishedAt: -1 }).limit(5).lean(),
      Event.find({ status: 'scheduled', startsAt: { $gt: now, $lte: new Date(now.getTime() + 7 * 86400000) } }, { title: 1, slug: 1, startsAt: 1, venue: 1 }).sort({ startsAt: 1 }).limit(3).lean(),
      getTrending(),
    ]);
    const props = {
      newBusinesses: fresh.map((b) => ({ name: b.name, detail: b.township?.replace(/-/g, ' '), url: url(`/business/${b.slug}`) })),
      events: events.map((e) => ({ title: e.title, startsAt: e.startsAt, venue: e.venue, url: url(`/events/${e.slug}`) })),
      trending: trending.slice(0, 3).map((b) => ({ name: b.name, detail: `★ ${b.rating} (${b.reviewCount})`, url: url(`/business/${b.slug}`) })),
    };
    if (!props.newBusinesses.length && !props.events.length && !props.trending.length) return { week, sent: 0, reason: 'nothing to send' };

    let sent = 0;
    let lastId = null;
    for (;;) {
      const users = await User.find({ status: 'active', 'preferences.notifications.weeklyDigest': true, ...(lastId ? { _id: { $gt: lastId } } : {}) }, { _id: 1 })
        .sort({ _id: 1 })
        .limit(BATCH)
        .lean();
      if (!users.length) break;
      for (const u of users) {
        const n = await notify({ userId: u._id, type: 'weekly_digest', title: 'Your kasi weekly', body: `${props.newBusinesses.length} new businesses and ${props.events.length} events this week`, link: '/explore', dedupeKey: `weekly_digest:${week}:${u._id}`, email: { template: 'weekly_digest', props } });
        if (n) sent += 1;
      }
      lastId = users[users.length - 1]._id;
    }
    return { week, sent };
  },
};
