import { addComment, deleteComment, listComments } from '../services/commentService.js';
import { cancelEvent, createEvent, getEvent, listEvents, nearbyEvents, setRsvp, updateEvent } from '../services/eventService.js';
import { createOffer, listOffers, removeOffer, updateOffer } from '../services/offerService.js';
import { createPost, deletePost, getPost, listPosts, removeReaction, setReaction, updatePost } from '../services/postService.js';

const page = (fn) => async (req, res) => {
  const { items, nextCursor } = await fn(req);
  res.json({ data: items, meta: { nextCursor, count: items.length } });
};
const one = (fn, status = 200) => async (req, res) => res.status(status).json({ data: await fn(req) });

// Posts and reactions
export const posts = page((req) => listPosts(req.validatedQuery, req.user));
export const post = one((req) => getPost(req.params.id, req.user));
export const newPost = one((req) => createPost(req.user, req.body), 201);
export const editPost = one((req) => updatePost(req.params.id, req.user, req.body));
export const removePost = one((req) => deletePost(req.params.id, req.user));
export const react = one((req) => setReaction(req.params.id, req.user, req.body.kind));
export const unreact = one((req) => removeReaction(req.params.id, req.user));

// Comments
export const comments = page((req) => listComments(req.params.id, req.validatedQuery, req.user));
export const newComment = one((req) => addComment(req.params.id, req.user, req.body.body), 201);
export const removeComment = one((req) => deleteComment(req.params.id, req.user));

// Events
export const events = page((req) => listEvents(req.validatedQuery, req.user));
export const eventsNearby = async (req, res) => {
  const items = await nearbyEvents(req.validatedQuery, req.user);
  res.json({ data: items, meta: { count: items.length } });
};
export const event = one((req) => getEvent(req.params.slug, req.user));
export const newEvent = one((req) => createEvent(req.user, req.body), 201);
export const editEvent = one((req) => updateEvent(req.params.id, req.user, req.body));
export const cancel = one((req) => cancelEvent(req.params.id, req.user));
export const going = one((req) => setRsvp(req.params.id, req.user, true));
export const notGoing = one((req) => setRsvp(req.params.id, req.user, false));

// Offers
export const offers = one((req) => listOffers(req.params.id, req.user, req.validatedQuery));
export const newOffer = one((req) => createOffer(req.params.id, req.user, req.body), 201);
export const editOffer = one((req) => updateOffer(req.params.id, req.user, req.body));
export const endOffer = one((req) => removeOffer(req.params.id, req.user));
