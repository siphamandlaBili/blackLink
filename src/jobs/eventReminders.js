import { env } from '../config/env.js';
import { Event, Rsvp } from '../models/index.js';
import { notify } from '../services/notifications.js';

/**
 * Hourly. Reminds everyone going to an event that starts within the next 24 hours.
 * Each RSVP gets one reminder: reminderSentAt is set, and the notification's dedupeKey
 * stops a second one even if two runs overlap.
 */
export const eventReminders = {
  name: 'event-reminders',
  key: (now) => now.toISOString().slice(0, 13),
  async run(now) {
    const events = await Event.find({ status: 'scheduled', startsAt: { $gt: now, $lte: new Date(now.getTime() + 24 * 3600000) } }).lean();
    let sent = 0;
    for (const e of events) {
      const rsvps = await Rsvp.find({ eventId: e._id, reminderSentAt: null }, { userId: 1 }).lean();
      for (const r of rsvps) {
        const n = await notify({
          userId: r.userId,
          type: 'event_reminder',
          title: `${e.title} is coming up`,
          body: `${e.venue} · ${new Date(e.startsAt).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', weekday: 'short', hour: '2-digit', minute: '2-digit' })}`,
          link: `/events/${e.slug}`,
          data: { eventId: String(e._id) },
          dedupeKey: `event_reminder:${e._id}:${r.userId}`,
          email: { template: 'event_reminder', props: { eventTitle: e.title, startsAt: e.startsAt, venue: e.venue, priceCents: e.priceCents, eventUrl: `${env.CLIENT_URL}/events/${e.slug}` } },
        });
        await Rsvp.updateOne({ _id: r._id }, { $set: { reminderSentAt: now } });
        if (n) sent += 1;
      }
    }
    return { events: events.length, sent };
  },
};
