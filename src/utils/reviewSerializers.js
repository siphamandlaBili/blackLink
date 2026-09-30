import { thumbnailUrl } from '../services/cloudinary.js';
import { userToPublic } from './serializers.js';

/**
 * Public review shape. Allowlist only: never textHash, status internals, or anything about
 * the reviewer beyond their public display name, badges and counts. Moderation status is
 * not shown: flagged reviews stay visible and look like any other.
 * @param {Object} r        Lean review.
 * @param {Object|null} author  Lean user (null for a former member).
 * @param {{ helpful?: boolean, mine?: boolean }} [viewer]
 */
export function reviewToPublic(r, author, viewer) {
  return {
    id: String(r._id),
    businessId: String(r.businessId),
    rating: r.rating,
    subRatings: r.subRatings ?? {},
    text: r.text,
    tags: r.tags ?? [],
    photos: (r.photos ?? []).filter((p) => p?.url).map((p) => ({ url: p.url, thumbUrl: p.publicId ? thumbnailUrl(p.publicId) : p.url })),
    visited: Boolean(r.visited),
    helpfulCount: r.helpfulCount ?? 0,
    edited: Boolean(r.edited),
    ownerReply: r.ownerReply ? { text: r.ownerReply.text, createdAt: r.ownerReply.createdAt, updatedAt: r.ownerReply.updatedAt } : null,
    author: r.formerMember || !author ? userToPublic(null) : userToPublic(author),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(viewer ? { viewer } : {}),
  };
}
