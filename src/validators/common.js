import mongoose from 'mongoose';
import { z } from 'zod';

/** A 24-hex MongoDB ObjectId string. */
export const objectId = z.string().refine((v) => mongoose.isValidObjectId(v) && /^[a-f\d]{24}$/i.test(v), 'must be a valid id');

/** Params schema for routes like /:id. */
export const idParams = z.object({ id: objectId }).strict();

/** An uploaded image, referenced by the Cloudinary public id returned by /uploads/sign. */
export const mediaRef = z.object({ publicId: z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9/_-]+$/) }).strict();

/** Cursor pagination query: ?cursor=&limit= (max 50). */
export const pageQuery = {
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
};
