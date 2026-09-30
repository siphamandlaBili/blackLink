import { DAYS, TIMEZONE } from '../config/constants.js';

/*
 * Opening hours in Africa/Johannesburg (SAST, UTC+2, no daylight saving).
 * Hours are stored per weekday as spans { open: "HH:MM", close: "HH:MM" }. A span whose
 * close is at or before its open runs past midnight (e.g. 18:00–02:00).
 *
 * For fast "open now" queries each business also stores `openRanges`: the same hours as
 * minute-of-week ranges { s, e } (Mon 00:00 = 0, week = 10080 minutes), with overnight
 * spans split at midnight and Sunday-night spans wrapped to Monday morning.
 */
export const WEEK_MINUTES = 7 * 1440;
const CLOSING_SOON_MIN = 60;

const toMinutes = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const toHHMM = (minutes) => {
  const m = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Weekday index (0 = Monday) and minute of week, in SAST, for a moment in time. */
export function sastClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  const day = DAYS.indexOf(get('weekday').slice(0, 3).toLowerCase());
  const minuteOfDay = Number(get('hour')) * 60 + Number(get('minute'));
  return { day, minuteOfDay, minuteOfWeek: day * 1440 + minuteOfDay };
}

/**
 * Converts stored hours to sorted, merged minute-of-week ranges.
 * @param {Record<string, Array<{ open: string, close: string }>>} hours
 * @returns {Array<{ s: number, e: number }>}
 */
export function weeklyRanges(hours = {}) {
  const raw = [];
  DAYS.forEach((day, i) => {
    for (const { open, close } of hours?.[day] ?? []) {
      const start = i * 1440 + toMinutes(open);
      let end = i * 1440 + toMinutes(close);
      if (end <= start) end += 1440; // runs past midnight
      if (end <= WEEK_MINUTES) raw.push({ s: start, e: end });
      else {
        // Sunday night into Monday morning: wrap the tail to the start of the week.
        raw.push({ s: start, e: WEEK_MINUTES });
        raw.push({ s: 0, e: end - WEEK_MINUTES });
      }
    }
  });
  raw.sort((a, b) => a.s - b.s);
  // Merge overlapping or touching ranges (e.g. 18:00–24:00 then 00:00–02:00).
  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.s <= last.e) last.e = Math.max(last.e, r.e);
    else merged.push({ ...r });
  }
  return merged;
}

/**
 * "Open now", "closing soon" (within the hour) or "closed", with the next change.
 * @param {Object} hours
 * @param {Date} [date]
 * @returns {{ status: 'open'|'closingSoon'|'closed', closesAt?: string, opensAt?: string, opensDay?: string }}
 */
export function openStatus(hours, date = new Date()) {
  const ranges = weeklyRanges(hours);
  if (!ranges.length) return { status: 'closed' };
  const { minuteOfWeek: now } = sastClock(date);

  // Treat the week as circular: a range ending at 10080 continues into one starting at 0.
  const current = ranges.find((r) => now >= r.s && now < r.e);
  if (current) {
    let end = current.e;
    if (end === WEEK_MINUTES && ranges[0].s === 0) end = WEEK_MINUTES + ranges[0].e;
    const left = end - now;
    return { status: left <= CLOSING_SOON_MIN ? 'closingSoon' : 'open', closesAt: toHHMM(end) };
  }
  const next = ranges.find((r) => r.s > now) ?? ranges[0];
  return { status: 'closed', opensAt: toHHMM(next.s), opensDay: DAYS[Math.floor(next.s / 1440) % 7] };
}

/** Mongo filter for businesses open at `date`, using the stored openRanges. */
export function openNowFilter(date = new Date()) {
  const { minuteOfWeek } = sastClock(date);
  return { openRanges: { $elemMatch: { s: { $lte: minuteOfWeek }, e: { $gt: minuteOfWeek } } } };
}
