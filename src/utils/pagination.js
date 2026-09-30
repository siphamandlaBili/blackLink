import mongoose from 'mongoose';
import { badRequest } from './errors.js';

/*
 * Cursor pagination. A cursor is an opaque base64url string holding the sort values of
 * the last item on the previous page. The next page starts strictly after it, so results
 * never repeat or skip when new rows are added between requests.
 *
 * `sort` is a list of [field, direction] pairs and always ends with ['_id', ±1] so every
 * position is unique.
 */

const encode = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

export function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null) throw new Error('bad');
    return value;
  } catch {
    throw badRequest('Invalid cursor');
  }
}

const getPath = (doc, path) => path.split('.').reduce((v, k) => (v == null ? v : v[k]), doc);

/** Cursor for the item after which the next page starts. Dates are stored as { d: ms }. */
export function cursorFor(doc, sort) {
  return encode({
    k: sort.map(([field]) => {
      const v = getPath(doc, field);
      if (v instanceof Date) return { d: v.getTime() };
      if (v instanceof mongoose.Types.ObjectId) return { o: String(v) };
      return v ?? null;
    }),
  });
}

const revive = (v) => {
  if (v && typeof v === 'object' && 'd' in v) return new Date(v.d);
  if (v && typeof v === 'object' && 'o' in v) {
    if (!mongoose.isValidObjectId(v.o)) throw badRequest('Invalid cursor');
    return new mongoose.Types.ObjectId(v.o);
  }
  if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) return v;
  throw badRequest('Invalid cursor');
};

/**
 * Mongo filter for "strictly after the cursor" under `sort`:
 *   (a > a0) OR (a = a0 AND b > b0) OR (a = a0 AND b = b0 AND _id > id0) …
 * with > replaced by < for descending fields.
 */
export function afterCursor(cursor, sort) {
  const decoded = decodeCursor(cursor);
  if (!decoded) return {};
  if (!Array.isArray(decoded.k) || decoded.k.length !== sort.length) throw badRequest('Invalid cursor');
  const values = decoded.k.map(revive);
  const or = sort.map(([field, dir], i) => {
    const clause = {};
    for (let j = 0; j < i; j += 1) clause[sort[j][0]] = values[j];
    clause[field] = { [dir === -1 ? '$lt' : '$gt']: values[i] };
    return clause;
  });
  return { $or: or };
}

/** Mongo sort object from the [field, dir] list. */
export const sortObject = (sort) => Object.fromEntries(sort);

/**
 * Trims one-extra-fetched results into a page plus meta.nextCursor.
 * Fetch `limit + 1` rows; if the extra row exists, there is another page.
 */
export function pageOf(rows, limit, sort) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? cursorFor(items[items.length - 1], sort) : null };
}

/** Offset cursors, only for text-relevance ordering, which has no stable sort key. */
export const offsetCursor = (offset) => encode({ o: offset });
export function offsetFrom(cursor) {
  const decoded = decodeCursor(cursor);
  if (!decoded) return 0;
  if (!Number.isInteger(decoded.o) || decoded.o < 0 || decoded.o > 10000) throw badRequest('Invalid cursor');
  return decoded.o;
}
