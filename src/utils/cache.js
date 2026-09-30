/**
 * Tiny in-process cache for read-heavy public endpoints (landing page). Each key holds one
 * value for `ttlMs`. Concurrent misses share one in-flight load, so a cold cache under load
 * runs the query once. Per instance: fine for one Render service; use Redis if scaled out.
 */
const store = new Map();

/**
 * @template T
 * @param {string} key
 * @param {number} ttlMs
 * @param {() => Promise<T>} load
 * @returns {Promise<T>}
 */
export async function cached(key, ttlMs, load) {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && hit.expires > now) return hit.promise;
  const promise = load();
  store.set(key, { promise, expires: now + ttlMs });
  try {
    return await promise;
  } catch (err) {
    store.delete(key); // don't cache failures
    throw err;
  }
}

/** Drops cached entries whose key starts with `prefix` (e.g. after a business publishes). */
export function invalidate(prefix = '') {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
}
