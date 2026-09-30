import { Comment, Post, User } from '../models/index.js';
import { commentToPublic } from '../utils/communitySerializers.js';
import { forbidden, notFound } from '../utils/errors.js';
import { afterCursor, pageOf, sortObject } from '../utils/pagination.js';
import { withTransaction } from '../utils/transaction.js';

// Comments read top to bottom, oldest first.
const OLDEST = [['createdAt', 1], ['_id', 1]];
const AUTHOR_FIELDS = { displayName: 1, avatarUrl: 1, badges: 1, reviewCount: 1, helpfulVotesReceived: 1 };

export async function listComments(postId, query, user) {
  if (!(await Post.exists({ _id: postId, status: 'published' }))) throw notFound('Post not found');
  const rows = await Comment.find({ postId, status: 'published', ...afterCursor(query.cursor, OLDEST) }).sort(sortObject(OLDEST)).limit(query.limit + 1).lean();
  const { items, nextCursor } = pageOf(rows, query.limit, OLDEST);
  const authors = await User.find({ _id: { $in: items.map((c) => c.authorId) } }, AUTHOR_FIELDS).lean();
  const byId = new Map(authors.map((a) => [String(a._id), a]));
  return {
    items: items.map((c) => commentToPublic(c, byId.get(String(c.authorId)), user ? { canDelete: String(c.authorId) === String(user._id) || user.role === 'admin' } : undefined)),
    nextCursor,
  };
}

/** Adds a comment and bumps the post's commentCount in one transaction. */
export async function addComment(postId, user, body) {
  const comment = await withTransaction(async (session) => {
    const post = await Post.findOne({ _id: postId, status: 'published' }, { _id: 1 }).session(session).lean();
    if (!post) throw notFound('Post not found');
    const [created] = await Comment.create([{ postId, authorId: user._id, body }], { session });
    await Post.updateOne({ _id: postId }, { $inc: { commentCount: 1 } }, { session, timestamps: false });
    return created.toObject();
  });
  const author = await User.findById(user._id, AUTHOR_FIELDS).lean();
  return commentToPublic(comment, author, { canDelete: true });
}

/**
 * The comment's author, the post's author (to keep their own thread tidy) or an admin.
 * Soft delete; the post's count goes down in the same transaction.
 */
export async function deleteComment(commentId, user) {
  return withTransaction(async (session) => {
    const comment = await Comment.findOne({ _id: commentId, status: 'published' }).session(session).lean();
    if (!comment) throw notFound('Comment not found');
    const post = await Post.findById(comment.postId, { authorId: 1 }).session(session).lean();
    const allowed = user.role === 'admin' || String(comment.authorId) === String(user._id) || String(post?.authorId) === String(user._id);
    if (!allowed) throw forbidden("You can't delete this comment");
    await Comment.updateOne({ _id: commentId }, { $set: { status: 'removed' } }, { session });
    await Post.updateOne({ _id: comment.postId, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } }, { session, timestamps: false });
    return { deleted: true };
  });
}
