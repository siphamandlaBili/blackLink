import { destroyMedia, verifyUpload } from './cloudinary.js';

/*
 * Clients attach images by sending back only the Cloudinary public id they uploaded to:
 * { publicId }. These helpers turn those references into stored media objects, verifying
 * any new upload with Cloudinary, keeping ones already attached as they are, and working
 * out which old images to delete from Cloudinary once the change is saved.
 */

const plain = (m) => (m?.toObject ? m.toObject() : m);

/**
 * @param {Array<{ publicId: string }>} refs     What the client wants attached, in order.
 * @param {Array<{ publicId?: string|null }>} current What's attached now.
 * @param {string} userId  The uploader; new uploads must be in their folder.
 * @returns {Promise<{ media: Array<Object>, removed: string[] }>}
 */
export async function resolveMediaList(refs, current, userId) {
  const existing = new Map((current ?? []).filter((m) => m?.publicId).map((m) => [m.publicId, plain(m)]));
  const media = [];
  for (const { publicId } of refs) {
    media.push(existing.get(publicId) ?? (await verifyUpload(publicId, userId)));
  }
  const kept = new Set(media.map((m) => m.publicId));
  const removed = [...existing.keys()].filter((id) => !kept.has(id));
  return { media, removed };
}

/** Same for a single image slot (logo, cover). `ref` null clears it. */
export async function resolveMediaOne(ref, current, userId) {
  const { media, removed } = await resolveMediaList(ref ? [ref] : [], current ? [current] : [], userId);
  return { media: media[0] ?? null, removed };
}

/** Deletes replaced or removed images after the database change has committed. */
export const cleanupMedia = (removed) => destroyMedia(removed);
