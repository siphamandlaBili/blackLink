import { AuditLog, Business, Comment, Post, Report, Review, User } from '../models/index.js';
import { invalidate } from '../utils/cache.js';
import { conflict, forbidden, notFound } from '../utils/errors.js';
import { afterCursor, pageOf, sortObject } from '../utils/pagination.js';
import { withTransaction } from '../utils/transaction.js';
import { emit } from './events.js';
import { recalcAuthor, recalcBusiness } from './trustRecalc.js';

/*
 * Admin moderation. Every action runs in a transaction together with its audit-log entry,
 * so there is never an action without a record (or a record without the action).
 * Negative reviews are never removed for being negative: "remove" is for content that
 * breaks the guidelines, and the moderator's note is kept in the audit log.
 */
const audit = (session, actor, action, targetType, targetId, reason = '', meta = {}) =>
  AuditLog.create([{ actorId: actor._id, action, targetType, targetId, reason, meta }], { session });

const excerpt = (s = '', n = 200) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What a moderator needs to judge each reported item, without anyone's private details. */
async function previews(reports) {
  const ids = (type) => reports.filter((r) => r.targetType === type).map((r) => r.targetId);
  const [reviews, posts, comments, businesses, users] = await Promise.all([
    Review.find({ _id: { $in: ids('review') } }, { rating: 1, text: 1, status: 1, businessId: 1, authorId: 1, visited: 1, createdAt: 1 }).lean(),
    Post.find({ _id: { $in: ids('post') } }, { type: 1, title: 1, body: 1, status: 1 }).lean(),
    Comment.find({ _id: { $in: ids('comment') } }, { body: 1, status: 1 }).lean(),
    Business.find({ _id: { $in: ids('business') } }, { name: 1, slug: 1, status: 1 }).lean(),
    User.find({ _id: { $in: ids('user') } }, { displayName: 1, status: 1 }).lean(),
  ]);
  const people = await User.find({ _id: { $in: [...reviews.map((r) => r.authorId), ...reports.map((r) => r.reporterId)].filter(Boolean) } }, { displayName: 1, createdAt: 1 }).lean();
  const shops = await Business.find({ _id: { $in: reviews.map((r) => r.businessId) } }, { name: 1, slug: 1 }).lean();
  const byId = (list) => new Map(list.map((x) => [String(x._id), x]));
  const [R, P, C, B, U, people2, shops2] = [reviews, posts, comments, businesses, users, people, shops].map(byId);
  return (report) => {
    const id = String(report.targetId);
    if (report.targetType === 'review' && R.has(id)) {
      const r = R.get(id);
      const author = people2.get(String(r.authorId));
      return { rating: r.rating, text: excerpt(r.text, 400), status: r.status, visited: r.visited, createdAt: r.createdAt, author: author?.displayName ?? 'Former member', authorSince: author?.createdAt ?? null, business: shops2.get(String(r.businessId)) ? { name: shops2.get(String(r.businessId)).name, slug: shops2.get(String(r.businessId)).slug } : null };
    }
    if (report.targetType === 'post' && P.has(id)) return { type: P.get(id).type, title: P.get(id).title, text: excerpt(P.get(id).body), status: P.get(id).status };
    if (report.targetType === 'comment' && C.has(id)) return { text: excerpt(C.get(id).body), status: C.get(id).status };
    if (report.targetType === 'business' && B.has(id)) return { name: B.get(id).name, slug: B.get(id).slug, status: B.get(id).status };
    if (report.targetType === 'user' && U.has(id)) return { displayName: U.get(id).displayName, status: U.get(id).status };
    return null;
  };
}

/** GET /admin/reports — open reports oldest first (a queue); resolved ones newest first. */
export async function listReports(q) {
  const sort = q.status === 'open' ? [['createdAt', 1], ['_id', 1]] : [['resolvedAt', -1], ['_id', -1]];
  const filter = { status: q.status, ...(q.targetType ? { targetType: q.targetType } : {}), ...(q.auto !== undefined ? { auto: q.auto } : {}) };
  const rows = await Report.find({ ...filter, ...afterCursor(q.cursor, sort) }).sort(sortObject(sort)).limit(q.limit + 1).lean();
  const { items, nextCursor } = pageOf(rows, q.limit, sort);
  const preview = await previews(items);
  const reporters = new Map((await User.find({ _id: { $in: items.map((r) => r.reporterId).filter(Boolean) } }, { displayName: 1 }).lean()).map((u) => [String(u._id), u.displayName]));
  return {
    items: items.map((r) => ({
      id: String(r._id), targetType: r.targetType, targetId: String(r.targetId), reason: r.reason, details: r.details, auto: r.auto, status: r.status,
      reporter: r.auto ? 'Automatic flag' : (reporters.get(String(r.reporterId)) ?? 'Former member'),
      target: preview(r), createdAt: r.createdAt, resolvedAt: r.resolvedAt, resolutionNote: r.resolutionNote,
    })),
    nextCursor,
  };
}

/** Takes content down. Returns the business ids whose scores must be recalculated. */
async function takeDown(report, session) {
  const { targetType: type, targetId: id } = report;
  if (type === 'review') {
    const review = await Review.findOneAndUpdate({ _id: id }, { $set: { status: 'removed' } }, { session, projection: { businessId: 1, authorId: 1 } }).lean();
    if (review) {
      await recalcBusiness(review.businessId, session);
      await recalcAuthor(review.authorId, session);
    }
  } else if (type === 'post') {
    await Post.updateOne({ _id: id }, { $set: { status: 'removed' } }, { session });
  } else if (type === 'comment') {
    const c = await Comment.findOneAndUpdate({ _id: id, status: { $ne: 'removed' } }, { $set: { status: 'removed' } }, { session }).lean();
    if (c) await Post.updateOne({ _id: c.postId, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } }, { session, timestamps: false });
  } else if (type === 'business') {
    await Business.updateOne({ _id: id, status: 'published' }, { $set: { status: 'suspended', suspendedReason: 'Removed after a report' } }, { session });
  } else if (type === 'user') {
    await User.updateOne({ _id: id, role: { $ne: 'admin' } }, { $set: { status: 'suspended', suspendedReason: 'Suspended after a report' } }, { session });
  }
}

/**
 * POST /admin/reports/:id/resolve — keep, remove or dismiss.
 * Removing closes every other open report on the same item too. Keeping or dismissing
 * un-flags an auto-flagged review once no open reports remain on it.
 */
export async function resolveReport(reportId, admin, { action, note = '' }) {
  const status = { keep: 'kept', remove: 'removed', dismiss: 'dismissed' }[action];
  const closed = await withTransaction(async (session) => {
    const report = await Report.findOne({ _id: reportId }).session(session).lean();
    if (!report) throw notFound('Report not found');
    if (report.status !== 'open') throw conflict('This report has already been resolved');
    const stamp = { status, resolvedBy: admin._id, resolvedAt: new Date(), resolutionNote: note };
    await Report.updateOne({ _id: reportId }, { $set: stamp }, { session });
    let siblings = [];
    if (action === 'remove') {
      await takeDown(report, session);
      siblings = await Report.find({ _id: { $ne: report._id }, targetType: report.targetType, targetId: report.targetId, status: 'open' }).session(session).lean();
      await Report.updateMany({ _id: { $in: siblings.map((s) => s._id) } }, { $set: stamp }, { session });
    } else if (report.targetType === 'review') {
      const stillOpen = await Report.exists({ targetType: 'review', targetId: report.targetId, status: 'open' }).session(session);
      if (!stillOpen) await Review.updateOne({ _id: report.targetId, status: 'flagged' }, { $set: { status: 'published' } }, { session, timestamps: false });
    }
    await audit(session, admin, `report.${action}`, report.targetType, report.targetId, note, { reportId: String(report._id), reason: report.reason, alsoClosed: siblings.length });
    return [report, ...siblings];
  });
  invalidate('public:');
  const outcome = status === 'removed' ? 'removed' : 'kept';
  for (const r of closed) if (r.reporterId) emit('report.resolved', { report: r, outcome });
  return { status, closed: closed.length };
}

const cannotTouch = (target, admin) => target.role === 'admin' || String(target._id) === String(admin._id);

export async function setUserSuspended(userId, admin, suspend, reason = '') {
  return withTransaction(async (session) => {
    const user = await User.findById(userId, { role: 1, status: 1 }).session(session).lean();
    if (!user || user.status === 'deleted') throw notFound('User not found');
    if (cannotTouch(user, admin)) throw forbidden("Admins can't suspend themselves or other admins");
    const next = suspend ? 'suspended' : 'active';
    if (user.status === next) throw conflict(`This account is already ${next}`);
    await User.updateOne({ _id: userId }, { $set: { status: next, suspendedReason: suspend ? reason : null } }, { session });
    await audit(session, admin, suspend ? 'user.suspend' : 'user.unsuspend', 'user', userId, reason);
    return { id: String(userId), status: next };
  });
}

export async function setBusinessSuspended(businessId, admin, suspend, reason = '') {
  const result = await withTransaction(async (session) => {
    const b = await Business.findById(businessId, { status: 1 }).session(session).lean();
    if (!b || b.status === 'deleted') throw notFound('Business not found');
    const [from, to] = suspend ? ['published', 'suspended'] : ['suspended', 'published'];
    if (b.status !== from) throw conflict(`Only ${from} listings can be ${suspend ? 'suspended' : 'restored'}`);
    await Business.updateOne({ _id: businessId }, { $set: { status: to, suspendedReason: suspend ? reason : null } }, { session });
    await audit(session, admin, suspend ? 'business.suspend' : 'business.unsuspend', 'business', businessId, reason);
    return { id: String(businessId), status: to };
  });
  invalidate('public:');
  return result;
}

/** POST /admin/businesses/:id/verify-cipc — approve (→ "registered") or reject a submitted CIPC number. */
export async function reviewCipc(businessId, admin, { approve, note = '' }) {
  const result = await withTransaction(async (session) => {
    const b = await Business.findById(businessId, { verification: 1 }).session(session).lean();
    if (!b) throw notFound('Business not found');
    if (b.verification.cipcStatus !== 'pending') throw conflict('There is no CIPC number waiting for review');
    const $set = approve ? { 'verification.cipcStatus': 'verified', 'verification.level': 'registered' } : { 'verification.cipcStatus': 'rejected' };
    await Business.updateOne({ _id: businessId }, { $set }, { session });
    if (approve) await recalcBusiness(businessId, session);
    await audit(session, admin, approve ? 'business.cipc_approve' : 'business.cipc_reject', 'business', businessId, note);
    return { id: String(businessId), cipcStatus: approve ? 'verified' : 'rejected', verificationLevel: approve ? 'registered' : b.verification.level };
  });
  invalidate('public:');
  return result;
}

export async function listAudit(q) {
  const sort = [['createdAt', -1], ['_id', -1]];
  const filter = { ...(q.targetType ? { targetType: q.targetType } : {}), ...(q.targetId ? { targetId: q.targetId } : {}), ...(q.actorId ? { actorId: q.actorId } : {}) };
  const rows = await AuditLog.find({ ...filter, ...afterCursor(q.cursor, sort) }).sort(sortObject(sort)).limit(q.limit + 1).lean();
  const { items, nextCursor } = pageOf(rows, q.limit, sort);
  const actors = new Map((await User.find({ _id: { $in: items.map((a) => a.actorId) } }, { displayName: 1 }).lean()).map((u) => [String(u._id), u.displayName]));
  return { items: items.map((a) => ({ id: String(a._id), action: a.action, targetType: a.targetType, targetId: String(a.targetId), reason: a.reason, meta: a.meta, actor: actors.get(String(a.actorId)) ?? 'Former admin', createdAt: a.createdAt })), nextCursor };
}
