import { replyToReview, reportReview, setHelpful } from '../services/reviewActions.js';
import { createReview, deleteReview, listMyReviews, listReviews, updateReview } from '../services/reviewService.js';

export const list = async (req, res) => {
  const { items, nextCursor, myReviewId } = await listReviews(req.params.id, req.validatedQuery, req.user);
  res.json({ data: items, meta: { nextCursor, count: items.length, ...(req.user ? { myReviewId } : {}) } });
};

export const mine = async (req, res) => {
  const { items, nextCursor } = await listMyReviews(req.user, req.validatedQuery);
  res.json({ data: items, meta: { nextCursor, count: items.length } });
};

export const create = async (req, res) => {
  res.status(201).json({ data: await createReview(req.params.id, req.user, req.body) });
};

export const update = async (req, res) => {
  res.json({ data: await updateReview(req.params.id, req.user, req.body) });
};

export const remove = async (req, res) => {
  res.json({ data: await deleteReview(req.params.id, req.user) });
};

export const markHelpful = async (req, res) => res.json({ data: await setHelpful(req.params.id, req.user, true) });
export const unmarkHelpful = async (req, res) => res.json({ data: await setHelpful(req.params.id, req.user, false) });

export const reply = async (req, res) => {
  res.json({ data: await replyToReview(req.params.id, req.user, req.body.text) });
};

export const report = async (req, res) => {
  res.status(201).json({ data: await reportReview(req.params.id, req.user, req.body) });
};
