import { listBusinesses, nearbyBusinesses } from '../services/businessQuery.js';
import { createDraft, deleteDraft, getProfile, listMine, publishBusiness, updateBusiness } from '../services/businessService.js';
import { follow, unfollow, vouch } from '../services/engagementService.js';

// Thin by design: parse → service → respond. Validation ran in the route, rules live in services.

export const list = async (req, res) => {
  const { items, nextCursor, total } = await listBusinesses(req.validatedQuery, req.user);
  res.json({ data: items, meta: { nextCursor, count: items.length, ...(total !== undefined ? { total } : {}) } });
};

export const nearby = async (req, res) => {
  const { items, meta } = await nearbyBusinesses(req.validatedQuery, req.user);
  res.json({ data: items, meta: { ...meta, count: items.length } });
};

export const profile = async (req, res) => {
  res.json({ data: await getProfile(req.params.slug, req.user) });
};

export const mine = async (req, res) => {
  res.json({ data: await listMine(req.user) });
};

export const create = async (req, res) => {
  res.status(201).json({ data: await createDraft(req.user, req.body) });
};

export const update = async (req, res) => {
  res.json({ data: await updateBusiness(req.params.id, req.user, req.body) });
};

export const removeDraft = async (req, res) => {
  res.json({ data: await deleteDraft(req.params.id, req.user) });
};

export const publish = async (req, res) => {
  res.json({ data: await publishBusiness(req.params.id, req.user) });
};

const respond = (fn) => async (req, res) => res.json({ data: await fn(req.params.id, req.user) });
export const followBusiness = respond(follow);
export const unfollowBusiness = respond(unfollow);
export const vouchBusiness = respond(vouch);
