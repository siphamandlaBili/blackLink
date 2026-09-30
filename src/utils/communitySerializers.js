import { thumbnailUrl } from '../services/cloudinary.js';
import { fromPoint } from './geo.js';
import { userToPublic } from './serializers.js';

/* Posts, comments, events and offers as the public sees them. Allowlists only. */

const media = (list = []) => list.filter((m) => m?.url).map((m) => ({ url: m.url, thumbUrl: m.publicId ? thumbnailUrl(m.publicId) : m.url }));
const businessRef = (b) => (b ? { id: String(b._id), name: b.name, slug: b.slug, category: b.category } : null);

export function postToPublic(p, { author, business, viewer } = {}) {
  return {
    id: String(p._id),
    type: p.type,
    title: p.title ?? '',
    body: p.body,
    media: media(p.media),
    topic: p.topic ?? null,
    lookingFor: p.lookingFor ?? null,
    collabStatus: p.collabStatus ?? null,
    spotlight: p.spotlight ? { from: p.spotlight.from, to: p.spotlight.to, story: p.spotlight.story, quote: p.spotlight.quote } : null,
    commentCount: p.commentCount ?? 0,
    reactionCount: p.reactionCount ?? 0,
    author: userToPublic(author ?? null),
    business: businessRef(business),
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    ...(viewer ? { viewer } : {}),
  };
}

export function commentToPublic(c, author, viewer) {
  return { id: String(c._id), postId: String(c.postId), body: c.body, author: userToPublic(author ?? null), createdAt: c.createdAt, ...(viewer ? { viewer } : {}) };
}

export function eventToPublic(e, { business, viewer } = {}) {
  return {
    id: String(e._id),
    slug: e.slug,
    title: e.title,
    type: e.type,
    description: e.description ?? '',
    location: fromPoint(e.location),
    venue: e.venue,
    township: e.township,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    priceCents: e.priceCents ?? 0,
    capacity: e.capacity ?? null,
    rsvpCount: e.rsvpCount ?? 0,
    spotsLeft: e.capacity ? Math.max(0, e.capacity - (e.rsvpCount ?? 0)) : null,
    status: e.status,
    host: businessRef(business),
    ...(typeof e.distanceM === 'number' ? { distanceM: Math.round(e.distanceM) } : {}),
    ...(viewer ? { viewer } : {}),
  };
}

/** Status is worked out from the dates, so an offer reads right even before the hourly expiry job runs. */
export function offerStatus(o, now = new Date()) {
  if (o.status !== 'active') return o.status;
  if (o.endsAt && new Date(o.endsAt) <= now) return 'expired';
  if (new Date(o.startsAt) > now) return 'scheduled';
  return 'active';
}

export function offerToPublic(o, now = new Date()) {
  return {
    id: String(o._id),
    businessId: String(o.businessId),
    title: o.title,
    description: o.description ?? '',
    priceCents: o.priceCents ?? null,
    startsAt: o.startsAt,
    endsAt: o.endsAt ?? null,
    status: offerStatus(o, now),
  };
}
