import { Business, Event, Rsvp } from '../models/index.js';
import { eventToPublic } from '../utils/communitySerializers.js';
import { AppError, conflict, forbidden, notFound } from '../utils/errors.js';
import { insideSoweto, toPoint } from '../utils/geo.js';
import { afterCursor, pageOf, sortObject } from '../utils/pagination.js';
import { uniqueSlug } from '../utils/slug.js';
import { withTransaction } from '../utils/transaction.js';

const SOONEST = [['startsAt', 1], ['_id', 1]];
const DAY = 86400000;
const canManage = (event, user) => user?.role === 'admin' || String(event.hostId) === String(user?._id);

async function hydrate(events, user) {
  const [hosts, going] = await Promise.all([
    Business.find({ _id: { $in: events.map((e) => e.businessId).filter(Boolean) } }, { name: 1, slug: 1, category: 1 }).lean(),
    user ? Rsvp.find({ userId: user._id, eventId: { $in: events.map((e) => e._id) } }, { eventId: 1 }).lean() : [],
  ]);
  const h = new Map(hosts.map((b) => [String(b._id), b]));
  const g = new Set(going.map((r) => String(r.eventId)));
  return events.map((e) =>
    eventToPublic(e, { business: e.businessId ? h.get(String(e.businessId)) : null, viewer: user ? { going: g.has(String(e._id)), canEdit: canManage(e, user) } : undefined }),
  );
}

/** GET /events — scheduled events that haven't ended, soonest first. `from`/`to` bound the start time. */
export async function listEvents(query, user) {
  const now = new Date();
  const filter = { status: 'scheduled', endsAt: { $gte: query.from && query.from > now ? query.from : now } };
  if (query.to) filter.startsAt = { $lt: query.to };
  if (query.type) filter.type = query.type;
  if (query.township) filter.township = query.township;
  if (query.free) filter.priceCents = 0;
  if (query.businessId) filter.businessId = query.businessId;
  const rows = await Event.find({ ...filter, ...afterCursor(query.cursor, SOONEST) }).sort(sortObject(SOONEST)).limit(query.limit + 1).lean();
  const { items, nextCursor } = pageOf(rows, query.limit, SOONEST);
  return { items: await hydrate(items, user), nextCursor };
}

/** GET /events/nearby — $geoNear first, then upcoming within `days`. Coordinates aren't stored. */
export async function nearbyEvents({ lat, lng, radiusKm, days, limit }, user) {
  const now = new Date();
  const rows = await Event.aggregate([
    {
      $geoNear: {
        near: toPoint(lat, lng),
        distanceField: 'distanceM',
        maxDistance: radiusKm * 1000,
        spherical: true,
        query: { status: 'scheduled', endsAt: { $gte: now }, startsAt: { $lte: new Date(now.getTime() + days * DAY) } },
      },
    },
    { $limit: limit },
  ]);
  return hydrate(rows, user);
}

export async function getEvent(slug, user) {
  const event = await Event.findOne({ slug, status: { $ne: 'removed' } }).lean();
  if (!event) throw notFound('Event not found');
  return (await hydrate([event], user))[0];
}

function checkWhereAndWhen({ location, startsAt, endsAt }, { requireFuture }) {
  if (location && !insideSoweto(location)) throw new AppError(422, 'OUTSIDE_SOWETO', 'Events must be in Soweto');
  if (requireFuture && startsAt && startsAt <= new Date()) throw new AppError(422, 'EVENT_IN_PAST', 'The start time must be in the future');
  if (startsAt && endsAt && endsAt <= startsAt) throw new AppError(422, 'EVENT_TIMES', 'The end must be after the start');
}

/** Any verified member can host; a host business, if named, must be theirs. */
export async function createEvent(user, input) {
  const { location, businessId, ...fields } = input;
  checkWhereAndWhen(input, { requireFuture: true });
  if (businessId) {
    const b = await Business.findOne({ _id: businessId, status: 'published' }, { ownerId: 1 }).lean();
    if (!b) throw notFound('Business not found');
    if (String(b.ownerId) !== String(user._id) && user.role !== 'admin') throw forbidden('You can only host as your own business');
  }
  const slug = await uniqueSlug(fields.title, (s) => Event.exists({ slug: s }));
  const event = await Event.create({ ...fields, slug, location: toPoint(location.lat, location.lng), businessId: businessId ?? null, hostId: user._id });
  return (await hydrate([event.toObject()], user))[0];
}

/** Host or admin. Capacity can't drop below the RSVPs already taken. */
export async function updateEvent(id, user, input) {
  const event = await Event.findOne({ _id: id, status: 'scheduled' }).lean();
  if (!event) throw notFound('Event not found');
  if (!canManage(event, user)) throw forbidden('Only the host can change this event');
  const merged = { startsAt: input.startsAt ?? event.startsAt, endsAt: input.endsAt ?? event.endsAt, location: input.location };
  checkWhereAndWhen(merged, { requireFuture: Boolean(input.startsAt) });
  if (input.capacity != null && input.capacity < event.rsvpCount) {
    throw new AppError(422, 'CAPACITY_TOO_LOW', `${event.rsvpCount} people are already going`, { rsvpCount: event.rsvpCount });
  }
  const { location, ...$set } = input;
  if (location) $set.location = toPoint(location.lat, location.lng);
  const saved = await Event.findByIdAndUpdate(id, { $set }, { new: true }).lean();
  return (await hydrate([saved], user))[0];
}

export async function cancelEvent(id, user) {
  const event = await Event.findOne({ _id: id, status: 'scheduled' }, { hostId: 1 }).lean();
  if (!event) throw notFound('Event not found');
  if (!canManage(event, user)) throw forbidden('Only the host can cancel this event');
  await Event.updateOne({ _id: id }, { $set: { status: 'cancelled' } });
  return { cancelled: true };
}

/**
 * RSVP toggle. The count only rises if there's room: the $inc is conditional on
 * rsvpCount < capacity, and if it doesn't apply the transaction (including the RSVP row)
 * is rolled back and the member gets 409 EVENT_FULL.
 */
export async function setRsvp(id, user, on) {
  return withTransaction(async (session) => {
    const event = await Event.findOne({ _id: id, status: 'scheduled', endsAt: { $gt: new Date() } }, { capacity: 1 }).session(session).lean();
    if (!event) throw notFound('Event not found or already over');
    if (on) {
      const res = await Rsvp.updateOne({ eventId: id, userId: user._id }, { $setOnInsert: { eventId: id, userId: user._id } }, { upsert: true, session });
      if (res.upsertedCount === 1) {
        const inc = await Event.updateOne(
          { _id: id, $or: [{ capacity: null }, { $expr: { $lt: ['$rsvpCount', '$capacity'] } }] },
          { $inc: { rsvpCount: 1 } },
          { session, timestamps: false },
        );
        if (inc.modifiedCount === 0) throw conflict('This event is full');
      }
    } else {
      const res = await Rsvp.deleteOne({ eventId: id, userId: user._id }, { session });
      if (res.deletedCount === 1) await Event.updateOne({ _id: id, rsvpCount: { $gt: 0 } }, { $inc: { rsvpCount: -1 } }, { session, timestamps: false });
    }
    const fresh = await Event.findById(id, { rsvpCount: 1, capacity: 1 }).session(session).lean();
    return { going: on, rsvpCount: fresh.rsvpCount, spotsLeft: fresh.capacity ? Math.max(0, fresh.capacity - fresh.rsvpCount) : null };
  });
}

/** GET /me/events — upcoming events the user said they're going to, soonest first. */
export async function myEvents(user) {
  const rsvps = await Rsvp.find({ userId: user._id }, { eventId: 1 }).sort({ createdAt: -1 }).limit(200).lean();
  const events = await Event.find({ _id: { $in: rsvps.map((r) => r.eventId) }, status: 'scheduled', endsAt: { $gt: new Date() } })
    .sort({ startsAt: 1 })
    .lean();
  return hydrate(events, user);
}

/**
 * GET /me/hosted-events — events you host: upcoming ones (scheduled or cancelled) and
 * those that ended in the last 30 days, soonest first.
 */
export async function myHostedEvents(user) {
  const since = new Date(Date.now() - 30 * 86400000);
  const events = await Event.find({ hostId: user._id, status: { $in: ['scheduled', 'cancelled'] }, endsAt: { $gt: since } })
    .sort({ startsAt: 1 })
    .limit(100)
    .lean();
  return hydrate(events, user);
}
