import { Business, Post, Reaction, User } from '../models/index.js';
import { invalidate } from '../utils/cache.js';
import { postToPublic } from '../utils/communitySerializers.js';
import { forbidden, notFound } from '../utils/errors.js';
import { afterCursor, pageOf, sortObject } from '../utils/pagination.js';
import { withTransaction } from '../utils/transaction.js';
import { cleanupMedia, resolveMediaList } from './mediaService.js';

const NEWEST = [['createdAt', -1], ['_id', -1]];
const AUTHOR_FIELDS = { displayName: 1, avatarUrl: 1, badges: 1, reviewCount: 1, helpfulVotesReceived: 1 };
const isAdmin = (u) => u?.role === 'admin';
const canManage = (post, user) => isAdmin(user) || String(post.authorId) === String(user?._id);

/** Adds author, business and the viewer's reaction to a batch of posts. */
async function hydrate(posts, user) {
  const [authors, businesses, reactions] = await Promise.all([
    User.find({ _id: { $in: posts.map((p) => p.authorId) } }, AUTHOR_FIELDS).lean(),
    Business.find({ _id: { $in: posts.map((p) => p.businessId).filter(Boolean) } }, { name: 1, slug: 1, category: 1 }).lean(),
    user ? Reaction.find({ userId: user._id, postId: { $in: posts.map((p) => p._id) } }, { postId: 1, kind: 1 }).lean() : [],
  ]);
  const a = new Map(authors.map((x) => [String(x._id), x]));
  const b = new Map(businesses.map((x) => [String(x._id), x]));
  const r = new Map(reactions.map((x) => [String(x.postId), x.kind]));
  return posts.map((p) =>
    postToPublic(p, {
      author: a.get(String(p.authorId)),
      business: p.businessId ? b.get(String(p.businessId)) : null,
      viewer: user ? { reaction: r.get(String(p._id)) ?? null, canEdit: canManage(p, user) } : undefined,
    }),
  );
}

export async function listPosts(query, user) {
  const filter = { status: 'published' };
  if (query.type) filter.type = query.type;
  if (query.topic) filter.topic = query.topic;
  if (query.businessId) filter.businessId = query.businessId;
  const rows = await Post.find({ ...filter, ...afterCursor(query.cursor, NEWEST) }).sort(sortObject(NEWEST)).limit(query.limit + 1).lean();
  const { items, nextCursor } = pageOf(rows, query.limit, NEWEST);
  return { items: await hydrate(items, user), nextCursor };
}

export async function getPost(id, user) {
  const post = await Post.findOne({ _id: id, status: 'published' }).lean();
  if (!post) throw notFound('Post not found');
  return (await hydrate([post], user))[0];
}

/**
 * Updates and collabs are posted for a business the author owns; threads by any verified
 * member; spotlights by admins only.
 */
export async function createPost(user, input) {
  const { media, businessId, ...fields } = input;
  if (fields.type === 'spotlight' && !isAdmin(user)) throw forbidden('Only the Black Link team can publish a Kasi Spotlight');
  if (businessId) {
    const b = await Business.findOne({ _id: businessId, status: 'published' }, { ownerId: 1 }).lean();
    if (!b) throw notFound('Business not found');
    if (fields.type !== 'spotlight' && String(b.ownerId) !== String(user._id) && !isAdmin(user)) throw forbidden('You can only post for your own business');
  }
  const doc = { ...fields, businessId: businessId ?? null, authorId: user._id };
  if (media) doc.media = (await resolveMediaList(media, [], String(user._id))).media;
  if (fields.type === 'collab') doc.collabStatus = 'open';
  const post = await Post.create(doc);
  if (fields.type === 'spotlight') invalidate('public:spotlight');
  return (await hydrate([post.toObject()], user))[0];
}

export async function updatePost(id, user, input) {
  const post = await Post.findOne({ _id: id, status: 'published' }).lean();
  if (!post) throw notFound('Post not found');
  if (!canManage(post, user)) throw forbidden('Only the author can change this post');
  const { media, ...$set } = input;
  if ($set.collabStatus && post.type !== 'collab') throw forbidden('Only collab requests can be opened or closed');
  let removed = [];
  if (media) {
    const r = await resolveMediaList(media, post.media, String(user._id));
    $set.media = r.media;
    removed = r.removed;
  }
  const saved = await Post.findByIdAndUpdate(id, { $set }, { new: true }).lean();
  cleanupMedia(removed);
  if (post.type === 'spotlight') invalidate('public:spotlight');
  return (await hydrate([saved], user))[0];
}

/** Author or admin. Soft delete (status "removed") keeps comment threads consistent. */
export async function deletePost(id, user) {
  const post = await Post.findOne({ _id: id, status: { $ne: 'removed' } }).lean();
  if (!post) throw notFound('Post not found');
  if (!canManage(post, user)) throw forbidden('Only the author can delete this post');
  await Post.updateOne({ _id: id }, { $set: { status: 'removed' } });
  cleanupMedia((post.media ?? []).map((m) => m.publicId));
  if (post.type === 'spotlight') invalidate('public:spotlight');
  return { deleted: true };
}

/**
 * PUT /posts/:id/reaction — one reaction per member per post. Changing its kind doesn't
 * change the count; only a new reaction or a removal moves reactionCount.
 */
export async function setReaction(id, user, kind) {
  return withTransaction(async (session) => {
    const post = await Post.findOne({ _id: id, status: 'published' }, { _id: 1 }).session(session).lean();
    if (!post) throw notFound('Post not found');
    const res = await Reaction.updateOne({ postId: id, userId: user._id }, { $set: { kind }, $setOnInsert: { postId: id, userId: user._id } }, { upsert: true, session });
    if (res.upsertedCount === 1) await Post.updateOne({ _id: id }, { $inc: { reactionCount: 1 } }, { session, timestamps: false });
    const fresh = await Post.findById(id, { reactionCount: 1 }).session(session).lean();
    return { reaction: kind, reactionCount: fresh.reactionCount };
  });
}

export async function removeReaction(id, user) {
  return withTransaction(async (session) => {
    const res = await Reaction.deleteOne({ postId: id, userId: user._id }, { session });
    if (res.deletedCount === 1) await Post.updateOne({ _id: id }, { $inc: { reactionCount: -1 } }, { session, timestamps: false });
    const fresh = await Post.findById(id, { reactionCount: 1 }).session(session).lean();
    if (!fresh) throw notFound('Post not found');
    return { reaction: null, reactionCount: Math.max(0, fresh.reactionCount) };
  });
}
