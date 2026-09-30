import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';
import { env } from './env.js';

// Filters on fields not in the schema are dropped rather than sent to MongoDB.
mongoose.set('strictQuery', true);
// Operator injection ("$gt", "$where" …) is blocked at the edge: every body, query and
// params object is parsed by a .strict() zod schema before it reaches a query. Mongoose's
// global sanitizeFilter isn't used because it also neutralises our own $in / $regex.

const MAX_ATTEMPTS = 8;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Connects with exponential backoff (1s, 2s, 4s … capped at 30s). Atlas free tier and
 * Render cold starts can take a moment, so a failed first try isn't fatal. Gives up
 * after MAX_ATTEMPTS and lets the caller exit.
 * @param {string} [uri]
 */
export async function connectDb(uri = env.MONGODB_URI) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await mongoose.connect(uri, { dbName: env.MONGODB_DB_NAME, serverSelectionTimeoutMS: 10000 });
      logger.info({ db: env.MONGODB_DB_NAME }, 'MongoDB connected');
      return mongoose.connection;
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS) throw err;
      const wait = Math.min(30000, 1000 * 2 ** (attempt - 1));
      logger.warn({ attempt, wait, reason: err.message }, 'MongoDB connection failed, retrying');
      await sleep(wait);
    }
  }
}

export async function disconnectDb() {
  await mongoose.connection.close();
  logger.info('MongoDB disconnected');
}

/** "up" when the driver can answer a ping, "down" otherwise. Used by the health check. */
export async function dbStatus() {
  if (mongoose.connection.readyState !== 1) return 'down';
  try {
    await mongoose.connection.db.admin().ping();
    return 'up';
  } catch {
    return 'down';
  }
}
