# Black Link API

Express + MongoDB (Mongoose) on Node 20+. Auth with Clerk (Phase 2).

## Repositories

The API and the web app are separate repositories. Two scripts here read the frontend's code, so they need it checked out with `npm install` run in it:

- `npm run smoke:frontend` runs the frontend's API services against this server.
- `npm run export:mock` regenerates `scripts/seed-data` from the frontend's mock data.

Both find the frontend automatically when it is the folder above this repo, or a sibling folder called `black-link` (the two repos cloned side by side). Anywhere else, set `FRONTEND_DIR`:

```bash
FRONTEND_DIR=../black-link NODE_ENV=test npm run smoke:frontend
```

Nothing the API runs in production depends on the frontend.

## Run locally

```bash
cd server
npm install
cp .env.example .env          # then edit if needed

# Terminal 1: a local MongoDB with no install (in-memory replica set, supports transactions)
npm run db:memory             # copy the printed MONGODB_URI into .env if it differs

# Terminal 2
npm run seed:reset            # wipe and load the Soweto demo data
npm run dev                   # API on http://localhost:4000, restarts on file changes
npm run smoke                 # checks health, errors, CORS, limits, indexes and seed data
NODE_ENV=test npm run smoke:auth   # checks webhooks, users, /api/me and the auth guards (no Clerk needed)
NODE_ENV=test npm run smoke:business   # checks discovery, onboarding, follows, vouches, landing data and SAST hours
NODE_ENV=test npm run smoke:reviews    # checks reviews, votes, replies, reports, auto-flagging and Trust Score maths
NODE_ENV=test npm run smoke:community  # checks uploads, posts, reactions, comments, events, RSVPs and offers
NODE_ENV=test npm run smoke:notify     # checks notifications, email rules and retries, unsubscribe, and the five jobs
NODE_ENV=test npm run smoke:admin      # checks tracking, the dashboard, moderation, suspensions, CIPC, export and deletion
NODE_ENV=test npm run smoke:frontend   # runs the frontend's API code against this server (needs the frontend repo, see below)
npm run email:preview                  # renders every email to server/.email-previews/*.html (sends nothing)
```

Using MongoDB Atlas instead: put the Atlas connection string in `MONGODB_URI` and skip `db:memory`.

## Auth (Clerk)

- The web app sends Clerk's session token as `Authorization: Bearer <token>` (from `getToken()`).
- `requireAuth` loads the Black Link user. If Clerk's `user.created` webhook hasn't arrived yet, it creates the user on the spot.
- `requireVerifiedEmail` is used for reviews and other trust-sensitive actions. `requireRole('owner' | 'admin')` guards routes, and admins pass every role check. Services still check who owns each record.
- `POST /api/webhooks/clerk` checks the svix signature against the raw body, and rejects replays older than 5 minutes.
  - It handles `user.created`, `user.updated` and `user.deleted`. Deletion is a soft delete.
  - Repeat deliveries of the same message are recognised and ignored.
  - Role, badges, preferences and counters are never overwritten from Clerk.
- In tests (`NODE_ENV=test`), Clerk is replaced by an `X-Test-Clerk-Id` header and a fixed webhook secret. Both are ignored in every other environment, and live Clerk keys are refused outside production.

## Routes so far

| Method and path | Who | What |
|---|---|---|
| `GET /api/health` | anyone | Status and database connectivity |
| `GET /api/me`, `PATCH /api/me/preferences` | signed in | Own account and preferences |
| `GET /api/businesses` | anyone | Search (`q`), filters, sorts, cursor pages (`cursor`, `limit` up to 50) |
| `GET /api/businesses/nearby` | anyone | `lat`, `lng`, `radiusKm` (0.5–20), filters, `sort` (best, distance, rated, trusted, popular, newest). Returns up to 50, with `distanceM`, `matchScore` and `reasons` |
| `GET /api/businesses/:slug` | anyone | Profile. Drafts are visible only to their owner |
| `GET /api/businesses/mine` | signed in | Own listings, drafts included |
| `POST /api/businesses` | signed in | Start a draft. Makes a customer an owner |
| `PATCH /api/businesses/:id` | owner or admin | Save a wizard step, or edit a live listing |
| `POST /api/businesses/:id/publish` | owner or admin | Needs name, category, pin in Soweto, township, WhatsApp and hours. Otherwise returns 422 with `missing` |
| `POST` / `DELETE /api/businesses/:id/follow` and `/save` | signed in | Counters update atomically, and repeats are harmless |
| `POST /api/businesses/:id/vouch` | verified email | Three vouches upgrade a listing to "vouched" |
| `GET /api/businesses/:id/reviews` | anyone | Filters: `stars` (for example `4,5`), `withPhotos` and `visited`. Sorts: `helpful`, `newest`, `highest` and `lowest`. Cursor pages. Signed-in viewers also get `meta.myReviewId` |
| `POST /api/businesses/:id/reviews` | verified email | `rating`, `text` (20–1000 characters) and optional `subRatings` and `tags`. An optional `location` is used once for the Visited check (within 150 m) and never stored. One per business (409), not your own business (403), and 5 per 24 hours (429) |
| `PATCH` / `DELETE /api/reviews/:id` | author | Edit (marked "edited") or delete |
| `POST` / `DELETE /api/reviews/:id/helpful` | verified email | Helpful vote. You can't vote on your own review |
| `PUT /api/reviews/:id/reply` | owner of that business | One public reply per review, editable |
| `POST /api/reviews/:id/report` | signed in | Reasons: `fake`, `offensive`, `spam`, `conflict_of_interest` and `not_real_experience` |
| `GET /api/me/reviews` | signed in | Your own reviews |
| `POST /api/uploads/sign` | signed in | Signed Cloudinary upload for a `purpose`: business-logo, business-cover, business-gallery, review-photo, post-media or event-image |
| `GET` / `POST /api/posts`, and `GET` / `PATCH` / `DELETE /api/posts/:id` | anyone to read; verified email to post | `update` and `collab` posts are for your own business. A `thread` needs a `topic`. Only admins can post a `spotlight` |
| `PUT` / `DELETE /api/posts/:id/reaction` | signed in | One reaction per member, with a `kind`: like, love, fire or clap |
| `GET` / `POST /api/posts/:id/comments`, and `DELETE /api/comments/:id` | anyone to read; verified email to comment | Comments are listed oldest first. The comment's author, the post's author or an admin can delete one |
| `GET /api/events`, `GET /api/events/nearby` and `GET /api/events/:slug` | anyone | `GET /api/events`: upcoming events, soonest first, filtered by `from`, `to`, `type`, `township` and `free`. `nearby` takes `lat`, `lng`, `radiusKm` and `days` |
| `POST /api/events`, and `PATCH` / `DELETE /api/events/:id` | host or admin | Soweto only and in the future. `DELETE` cancels the event. Capacity can't drop below the RSVPs already taken |
| `POST` / `DELETE /api/events/:id/rsvp` | signed in | Capacity is checked atomically. A full event returns 409 |
| `GET` / `POST /api/businesses/:id/offers`, and `PATCH` / `DELETE /api/offers/:id` | anyone to read; owner to write | Up to 5 running offers. `?all=true` shows the owner scheduled and expired offers too. `hasActiveOffer` stays in sync |
| `GET /api/me/notifications`, `PATCH /api/me/notifications/:id/read` and `POST /api/me/notifications/read-all` | signed in | Your notifications, with `meta.unreadCount`. `?unread=true` shows unread only |
| `GET` / `POST /api/unsubscribe?token=` | anyone with the link | One-click unsubscribe from an email. The token is signed. GET returns a small page, and POST is for mail apps (RFC 8058) |
| `POST /api/jobs/:name` | `X-Job-Secret` header | Runs one job: `offer-expiry`, `event-reminders`, `weekly-digest`, `trust-refresh` or `purge-deleted` |
| `POST /api/track` | anyone | `{ businessId, event }`, where event is `view`, `whatsapp`, `call`, `directions` or `website`. Anonymous daily counters. Rate limited per IP and per business. A repeat view within 30 minutes counts once, and owners aren't counted. Always returns 202 |
| `GET /api/dashboard/:businessId?range=30|90` | owner or admin | Engagement series with the previous period, followers gained, reviews, response rate, unanswered reviews, rating over time, and a weekly Trust Score trend |
| `GET /api/admin/reports` and `POST /api/admin/reports/:id/resolve` | admin | Moderation queue with a preview of each item. `action` is `keep`, `remove` or `dismiss`. Removing closes every open report on the same item, and reporters are notified |
| `POST /api/admin/users/:id/suspend` and `/unsuspend`, plus the same for `/api/admin/businesses/:id` | admin | A `reason` is required. Admins can't suspend themselves or other admins |
| `POST /api/admin/businesses/:id/verify-cipc` | admin | `{ approve }`. Approving a pending CIPC number makes the listing "registered" |
| `GET /api/admin/audit` | admin | Every admin action, newest first, filterable by target or actor |
| `GET /api/me/export` | signed in | POPIA: everything stored about you, as a JSON download |
| `DELETE /api/me` | signed in | Body `{ "confirm": "DELETE" }`. Your reviews become "Former member", your listings come down, your Clerk account is deleted, and the rest is purged after 30 days |
| `GET /api/public/stats`, `featured`, `trending`, `activity`, `spotlight`, `categories` | anyone | Landing page data, cached for 5 minutes |

Filters for `/businesses` and `/nearby`: `category` and `township` (comma lists), `minRating`, `minTrust`, `price` (for example `1,2`), `verification` (the minimum level), and `openNow`, `newThisMonth`, `hasOffers` and `backupPower` (all `true` or `false`).

## Reviews and Trust Score

- Every review create, edit and delete, and every helpful vote and owner reply, runs in one MongoDB transaction. It writes the change, recalculates the business's stats and Trust Score, and updates the author's review count, credibility and badges.
- The Trust Score maths lives in `src/services/trustScore.js`, a pure function. Every weight and tier threshold is in the exported `TRUST_CONFIG`.
- Auto-flagging lives in `src/services/moderation.js`, with its thresholds in `MODERATION_CONFIG`. It flags:
  - 5 or more reviews for one business within an hour.
  - 3 or more reviews within 24 hours from accounts under 24 hours old.
  - Near-duplicate text.
- Flagged reviews stay visible, and each one gets an automatic open report in the moderation queue.
- After each change, `review.created` and `review.replied` events fire (`src/services/events.js`) for notifications in Phase 6.

## Uploads (Cloudinary)

1. The client calls `POST /api/uploads/sign`, then POSTs the file, together with the returned `fields`, straight to `uploadUrl`. No image bytes pass through the API.
2. The signature fixes the folder (`blacklink/users/<userId>`), the file name, the allowed formats and an eager 640px thumbnail. Cloudinary rejects any change to them.
3. The client attaches the image by sending `{ publicId }` to the route that uses it, for example `PATCH /api/businesses/:id { cover }`. The server looks the file up on Cloudinary, and uses it only if it's in that user's folder, is an image, and is at most 5 MB. A URL sent by the client is never trusted.
4. Replaced or removed images are deleted from Cloudinary after the change is saved.

## Emails, notifications and jobs

- Every notification is saved in-app, and emailed if the user wants it. `services/notifications.js` handles this:
  - Each notification carries a `dedupeKey`, so the same event never notifies anyone twice.
  - Email respects the user's notification preferences.
  - Seeded (`@seed.blacklink.test`) and placeholder addresses are never emailed.
- Sending happens in the background after the response, and retries once. The outcome is stored in `emailStatus` (`sent`, `failed` or `skipped`). An email failure never fails an API request.
- Templates live in `src/emails`: flat and light, with a gold button, no gradients and no borders. Each has an unsubscribe link and a one-click `List-Unsubscribe` header.
- The jobs are triggered by GitHub Actions (`.github/workflows/jobs.yml`), because Render's free tier sleeps:

| Job | When | What |
|---|---|---|
| `offer-expiry` | Hourly | Expires ended offers and resyncs `hasActiveOffer` |
| `event-reminders` | Hourly | Reminds RSVPs of events starting within 24 hours, once each |
| `weekly-digest` | Mondays 08:00 SAST | New businesses, upcoming events and trending, for members who opted in |
| `trust-refresh` | Nightly, 02:00 SAST | Recalculates every Trust Score, because recency changes with time |
| `purge-deleted` | Nightly, 02:00 SAST | POPIA: permanently removes accounts deleted over 30 days ago. Their reviews become "Former member" |

- Each job runs at most once per hour, day or week. A second call in the same period is skipped. `?force=true` reruns it, and the job's own work is idempotent anyway.

## Conventions

- Success responses are `{ data, meta? }`. Errors are `{ error: { code, message, details? } }` with the right HTTP status.
- Every request gets an `X-Request-Id`, and it's echoed back in the response.
- `GET /api/health` returns status and database connectivity. It sends 503 when the database is down.
- Money is stored in integer cents (ZAR). Times are calculated in Africa/Johannesburg.
- Coordinates are GeoJSON, in `[lng, lat]` order.
- Logs never contain personal data.

## Seed data

`scripts/seed-data/*.json` holds the demo data. The businesses, reviewers, reviews and events are exported from the frontend mock data with `npm run export:mock`, which needs the frontend repo (see below). Posts and heritage sites are written by hand.

Dates are stored as "days ago" or "in days", so the demo data always looks current.

The seed is idempotent. It upserts on natural keys: email, slug, and business + author. Demo accounts use `@seed.blacklink.test` addresses, which can't receive mail.
