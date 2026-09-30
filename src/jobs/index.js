import { JobRun } from '../models/index.js';
import { logger } from '../utils/logger.js';
import { eventReminders } from './eventReminders.js';
import { offerExpiry } from './offerExpiry.js';
import { purgeDeleted } from './purgeDeleted.js';
import { trustRefresh } from './trustRefresh.js';
import { weeklyDigest } from './weeklyDigest.js';

export const JOBS = Object.fromEntries([offerExpiry, eventReminders, weeklyDigest, trustRefresh, purgeDeleted].map((j) => [j.name, j]));
const STALE_MS = 30 * 60 * 1000;

/**
 * Runs a job at most once per period. (name, key) is unique in jobRuns, e.g.
 * ("weekly-digest", "2026-W40"): a second call in the same period returns the first run's
 * result with skipped: true. A failed run, or one stuck "running" for 30+ minutes (the
 * server restarted mid-job), can be run again. Each job's own work is idempotent too.
 */
export async function runJob(name, { now = new Date(), force = false } = {}) {
  const job = JOBS[name];
  if (!job) return null;
  const key = job.key(now);

  const claim = await JobRun.findOneAndUpdate(
    { name, key, ...(force ? {} : { $or: [{ status: 'failed' }, { status: 'running', startedAt: { $lt: new Date(Date.now() - STALE_MS) } }] }) },
    { $set: { status: 'running', startedAt: new Date(), finishedAt: null } },
    { new: true },
  ).lean();
  if (!claim) {
    try {
      await JobRun.create({ name, key, status: 'running' });
    } catch (err) {
      if (err?.code !== 11000) throw err;
      const existing = await JobRun.findOne({ name, key }).lean();
      return { name, key, skipped: true, status: existing.status, result: existing.result };
    }
  }

  try {
    const result = await job.run(now);
    await JobRun.updateOne({ name, key }, { $set: { status: 'done', finishedAt: new Date(), result } });
    logger.info({ job: name, key, result }, 'Job finished');
    return { name, key, skipped: false, status: 'done', result };
  } catch (err) {
    await JobRun.updateOne({ name, key }, { $set: { status: 'failed', finishedAt: new Date(), result: { error: err.message } } });
    logger.error({ job: name, key, reason: err.message }, 'Job failed');
    throw err;
  }
}
