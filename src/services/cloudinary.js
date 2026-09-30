import { randomBytes } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { env, isTest } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/*
 * Signed direct uploads: the browser uploads straight to Cloudinary (no image bytes pass
 * through our server), using parameters this server signs. Because the signature covers
 * the folder, public id, allowed formats and eager transformation, the browser can't
 * change any of them.
 *
 * Cloudinary's upload API has no signed size limit, so after uploading, the client sends
 * back only the public id and the server looks the file up (verifyUpload) before using it:
 * it must be in that user's folder, be an image, and be at most 5 MB. A URL sent by the
 * client is never trusted.
 */
export const UPLOAD_RULES = Object.freeze({
  maxBytes: 5 * 1024 * 1024,
  formats: ['jpg', 'jpeg', 'png', 'webp', 'heic'],
  // Eager transformation generated at upload time: the 640px-wide thumbnail cards use.
  thumbnail: 'c_limit,w_640/f_auto,q_auto',
  signatureTtlSeconds: 15 * 60,
});

if (!isTest) cloudinary.config({ cloud_name: env.CLOUDINARY_CLOUD_NAME, api_key: env.CLOUDINARY_API_KEY, api_secret: env.CLOUDINARY_API_SECRET, secure: true });

export const userFolder = (userId) => `blacklink/users/${userId}`;

/** A 640px thumbnail URL for any uploaded image (same transformation as the eager one). */
export function thumbnailUrl(publicId) {
  if (isTest) return `https://res.cloudinary.test/image/upload/${UPLOAD_RULES.thumbnail}/${publicId}`;
  return cloudinary.url(publicId, { secure: true, transformation: [{ crop: 'limit', width: 640 }, { fetch_format: 'auto', quality: 'auto' }] });
}

/**
 * Signed parameters for one upload by this user.
 * @param {string} userId
 * @param {string} purpose e.g. "business-cover", "review-photo" (becomes part of the file name).
 */
export function signUpload(userId, purpose) {
  const timestamp = Math.floor(Date.now() / 1000);
  const params = {
    timestamp,
    folder: userFolder(userId),
    public_id: `${purpose}-${Date.now().toString(36)}${randomBytes(4).toString('hex')}`,
    allowed_formats: UPLOAD_RULES.formats.join(','),
    eager: UPLOAD_RULES.thumbnail,
  };
  const cloudName = isTest ? 'test-cloud' : env.CLOUDINARY_CLOUD_NAME;
  const apiKey = isTest ? '000000000000000' : env.CLOUDINARY_API_KEY;
  const signature = isTest ? 'test-signature' : cloudinary.utils.api_sign_request(params, env.CLOUDINARY_API_SECRET);
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    // Send these form fields exactly as given, plus `file`.
    fields: { ...params, api_key: apiKey, signature },
    publicId: `${params.folder}/${params.public_id}`,
    maxBytes: UPLOAD_RULES.maxBytes,
    expiresAt: new Date((timestamp + UPLOAD_RULES.signatureTtlSeconds) * 1000).toISOString(),
  };
}

// Tests register fake "uploaded" files here instead of calling Cloudinary.
const testFiles = new Map();
export function registerTestUpload(publicId, info) {
  if (!isTest) throw new Error('registerTestUpload is only available in tests');
  testFiles.set(publicId, { resource_type: 'image', format: 'jpg', bytes: 200000, width: 1200, height: 800, ...info });
}
export const testDestroyed = [];

/**
 * Confirms an upload belongs to this user and meets the rules, and returns what we store.
 * Anything outside the user's folder, not an image, or over 5 MB is rejected (and oversized
 * files are deleted so they don't linger).
 * @returns {Promise<{ url: string, publicId: string, width: number, height: number }>}
 */
export async function verifyUpload(publicId, userId) {
  if (typeof publicId !== 'string' || !publicId.startsWith(`${userFolder(userId)}/`)) {
    throw new AppError(403, 'UPLOAD_NOT_YOURS', 'That image was not uploaded by you');
  }
  let info;
  try {
    info = isTest ? testFiles.get(publicId) : await cloudinary.api.resource(publicId, { resource_type: 'image' });
  } catch (err) {
    if (err?.error?.http_code !== 404) logger.error({ err: err?.error?.message ?? err?.message }, 'Cloudinary lookup failed');
  }
  if (!info) throw new AppError(422, 'UPLOAD_NOT_FOUND', 'Upload not found. Try uploading the image again.');
  if (info.resource_type !== 'image' || !UPLOAD_RULES.formats.includes(String(info.format).toLowerCase())) {
    throw new AppError(422, 'UPLOAD_NOT_IMAGE', 'Only JPG, PNG, WebP or HEIC images are allowed');
  }
  if (info.bytes > UPLOAD_RULES.maxBytes) {
    destroyMedia([publicId]);
    throw new AppError(422, 'UPLOAD_TOO_LARGE', 'Images can be at most 5 MB');
  }
  const url = isTest ? `https://res.cloudinary.test/image/upload/${publicId}.${info.format}` : info.secure_url;
  return { url, publicId, width: info.width, height: info.height };
}

/**
 * Deletes images from Cloudinary in the background. Never throws: a failed delete is logged
 * and leaves an orphaned file, which is harmless and can be cleaned up later.
 * @param {Array<string|null|undefined>} publicIds
 */
export function destroyMedia(publicIds) {
  const ids = publicIds.filter(Boolean);
  if (!ids.length) return;
  if (isTest) {
    testDestroyed.push(...ids);
    return;
  }
  setImmediate(async () => {
    for (const id of ids) {
      try {
        await cloudinary.uploader.destroy(id, { resource_type: 'image', invalidate: true });
      } catch (err) {
        logger.warn({ reason: err?.message }, 'Cloudinary delete failed');
      }
    }
  });
}
