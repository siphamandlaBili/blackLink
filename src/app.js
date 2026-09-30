import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { clerkAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { requestId } from './middleware/requestId.js';
import { admin, dashboard } from './routes/admin.js';
import businessesRouter from './routes/businesses.js';
import { businessOffers, comments, events, offers, posts } from './routes/community.js';
import healthRouter from './routes/health.js';
import jobsRouter from './routes/jobs.js';
import trackRouter from './routes/track.js';
import meRouter from './routes/me.js';
import { myNotifications, unsubscribe } from './routes/notifications.js';
import publicRouter from './routes/public.js';
import { businessReviews, myReviews, reviews } from './routes/reviews.js';
import uploadsRouter from './routes/uploads.js';
// Registers the notification listeners (review created, owner replied, …) once.
import './services/listeners.js';
import { logger } from './utils/logger.js';
import clerkWebhookRouter from './webhooks/clerk.js';

/**
 * Builds the Express app. Kept separate from server.js so tests can mount it with
 * supertest without opening a port.
 */
export function createApp() {
  const app = express();

  // Render (and most hosts) sit behind one proxy; this makes req.ip the real client IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      // Log method, path and status only: no bodies, no query strings (they can hold search terms).
      serializers: {
        req: (req) => ({ id: req.id, method: req.method, path: req.url.split('?')[0] }),
        res: (res) => ({ status: res.statusCode }),
      },
      autoLogging: { ignore: (req) => req.url === '/api/health' },
    }),
  );

  app.use(helmet());
  app.use(
    cors({
      // Only the web app may call the API from a browser. Requests without an Origin
      // header (curl, server-to-server, webhooks) aren't subject to CORS at all.
      origin: (origin, cb) => (!origin || origin === env.CLIENT_URL ? cb(null, true) : cb(new Error('CORS: origin not allowed'))),
      credentials: true,
      maxAge: 600,
    }),
  );
  app.use('/api', globalLimiter);

  // Signed webhooks need the raw body, so they're mounted before the JSON parser.
  app.use('/api/webhooks/clerk', clerkWebhookRouter);

  app.use(express.json({ limit: '100kb' }));
  // Reads the Clerk session on every API request; routes decide whether it's required.
  app.use('/api', clerkAuth);

  app.use('/api/health', healthRouter);
  app.use('/api/me/reviews', myReviews);
  app.use('/api/me/notifications', myNotifications);
  app.use('/api/me', meRouter);
  app.use('/api/businesses/:id/reviews', businessReviews);
  app.use('/api/businesses/:id/offers', businessOffers);
  app.use('/api/businesses', businessesRouter);
  app.use('/api/reviews', reviews);
  app.use('/api/uploads', uploadsRouter);
  app.use('/api/posts', posts);
  app.use('/api/comments', comments);
  app.use('/api/events', events);
  app.use('/api/offers', offers);
  app.use('/api/unsubscribe', unsubscribe);
  app.use('/api/jobs', jobsRouter);
  app.use('/api/track', trackRouter);
  app.use('/api/dashboard', dashboard);
  app.use('/api/admin', admin);
  app.use('/api/public', publicRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
