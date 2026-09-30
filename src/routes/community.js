import { Router } from 'express';
import { z } from 'zod';
import * as c from '../controllers/communityController.js';
import { asyncHandler as h } from '../middleware/asyncHandler.js';
import { optionalAuth, requireAuth, requireVerifiedEmail } from '../middleware/auth.js';
import { createLimiter } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { idParams, pageQuery } from '../validators/common.js';
import {
  commentCreate, eventCreate, eventListQuery, eventNearbyQuery, eventPatch, offerCreate, offerListQuery, offerPatch,
  postCreate, postListQuery, postPatch, reactionBody, slugParams,
} from '../validators/community.js';

const perUser = (req) => (req.user ? `u:${req.user._id}` : `ip:${req.ip}`);
const writeLimit = createLimiter({ windowMs: 60 * 60 * 1000, limit: 30, keyGenerator: perUser });
const tapLimit = createLimiter({ windowMs: 60 * 1000, limit: 60, keyGenerator: perUser });
const pageOnly = z.object(pageQuery).strict();
const id = { params: idParams };

/** /api/posts */
export const posts = Router();
posts.get('/', optionalAuth, validate({ query: postListQuery }), h(c.posts));
posts.get('/:id', optionalAuth, validate(id), h(c.post));
posts.post('/', requireAuth, requireVerifiedEmail, writeLimit, validate({ body: postCreate }), h(c.newPost));
posts.patch('/:id', requireAuth, writeLimit, validate({ ...id, body: postPatch }), h(c.editPost));
posts.delete('/:id', requireAuth, validate(id), h(c.removePost));
posts.put('/:id/reaction', requireAuth, tapLimit, validate({ ...id, body: reactionBody }), h(c.react));
posts.delete('/:id/reaction', requireAuth, tapLimit, validate(id), h(c.unreact));
posts.get('/:id/comments', optionalAuth, validate({ ...id, query: pageOnly }), h(c.comments));
posts.post('/:id/comments', requireAuth, requireVerifiedEmail, writeLimit, validate({ ...id, body: commentCreate }), h(c.newComment));

/** /api/comments */
export const comments = Router();
comments.delete('/:id', requireAuth, validate(id), h(c.removeComment));

/** /api/events */
export const events = Router();
events.get('/', optionalAuth, validate({ query: eventListQuery }), h(c.events));
events.get('/nearby', optionalAuth, validate({ query: eventNearbyQuery }), h(c.eventsNearby));
events.post('/', requireAuth, requireVerifiedEmail, writeLimit, validate({ body: eventCreate }), h(c.newEvent));
events.patch('/:id', requireAuth, writeLimit, validate({ ...id, body: eventPatch }), h(c.editEvent));
events.delete('/:id', requireAuth, validate(id), h(c.cancel));
events.post('/:id/rsvp', requireAuth, tapLimit, validate(id), h(c.going));
events.delete('/:id/rsvp', requireAuth, tapLimit, validate(id), h(c.notGoing));
// Slug last, so /nearby isn't read as a slug.
events.get('/:slug', optionalAuth, validate({ params: slugParams }), h(c.event));

/** /api/businesses/:id/offers */
export const businessOffers = Router({ mergeParams: true });
businessOffers.get('/', optionalAuth, validate({ ...id, query: offerListQuery }), h(c.offers));
businessOffers.post('/', requireAuth, writeLimit, validate({ ...id, body: offerCreate }), h(c.newOffer));

/** /api/offers */
export const offers = Router();
offers.patch('/:id', requireAuth, writeLimit, validate({ ...id, body: offerPatch }), h(c.editOffer));
offers.delete('/:id', requireAuth, validate(id), h(c.endOffer));
