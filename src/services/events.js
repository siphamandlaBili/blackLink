import { EventEmitter } from 'node:events';
import { logger } from '../utils/logger.js';

/**
 * In-process domain events, emitted after a transaction commits. Listeners (Phase 6:
 * notifications and emails) must never throw into the request that emitted the event,
 * so every listener runs in its own try/catch and failures are only logged.
 *
 *   review.created  { review, business }
 *   review.replied  { review, business }
 *   business.published { business }
 */
const bus = new EventEmitter();
bus.setMaxListeners(50);

export function emit(name, payload) {
  // setImmediate: the HTTP response is never held up by listeners.
  setImmediate(() => bus.emit(name, payload));
}

export function on(name, listener) {
  bus.on(name, async (payload) => {
    try {
      await listener(payload);
    } catch (err) {
      logger.error({ err, event: name }, 'Event listener failed');
    }
  });
}
