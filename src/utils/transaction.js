import mongoose from 'mongoose';

/**
 * Runs `fn(session)` in a MongoDB transaction and returns its result. The driver retries
 * the whole callback on transient errors (e.g. two writers touching the same document),
 * so `fn` must be safe to run more than once: no side effects outside the database.
 * Needs a replica set (Atlas, or `npm run db:memory` locally).
 * @template T
 * @param {(session: import('mongoose').ClientSession) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withTransaction(fn) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
