import {
  Business, Comment, Follow, Notification, Post, Reaction, Review, ReviewVote, Rsvp, Save, User, Vouch,
} from '../models/index.js';
import { destroyMedia } from '../services/cloudinary.js';
import { recalcBusiness } from '../services/trustRecalc.js';
import { sastDay } from './trustRefresh.js';

export const PURGE_AFTER_DAYS = 30;

/**
 * Nightly (POPIA). Permanently removes the personal data of accounts soft-deleted more
 * than 30 days ago:
 *  - reviews stay (so business scores stay fair) but become "Former member": no author,
 *    no photos;
 *  - follows, saves, vouches, votes, RSVPs, reactions, comments, posts and notifications go;
 *  - their business listings are deleted and their images removed from Cloudinary;
 *  - finally the user document itself is deleted.
 * Idempotent: once an account is gone there is nothing left to do for it.
 */
export const purgeDeleted = {
  name: 'purge-deleted',
  key: sastDay,
  async run(now) {
    const cutoff = new Date(now.getTime() - PURGE_AFTER_DAYS * 86400000);
    const users = await User.find({ status: 'deleted', deletedAt: { $ne: null, $lte: cutoff } }, { _id: 1 }).lean();
    const touched = new Set();
    for (const { _id: userId } of users) {
      const reviews = await Review.find({ authorId: userId }, { businessId: 1, photos: 1 }).lean();
      reviews.forEach((r) => touched.add(String(r.businessId)));
      destroyMedia(reviews.flatMap((r) => (r.photos ?? []).map((p) => p.publicId)));
      await Review.updateMany({ authorId: userId }, { $set: { authorId: null, formerMember: true, photos: [] } }, { timestamps: false });

      const owned = await Business.find({ ownerId: userId, status: { $ne: 'deleted' } }, { logo: 1, cover: 1, gallery: 1 }).lean();
      destroyMedia(owned.flatMap((b) => [b.logo?.publicId, b.cover?.publicId, ...(b.gallery ?? []).map((g) => g.publicId)]));
      await Business.updateMany({ ownerId: userId, status: { $ne: 'deleted' } }, { $set: { status: 'deleted', deletedAt: now, whatsapp: null, phone: null } });

      const follows = await Follow.find({ userId }, { businessId: 1 }).lean();
      for (const f of follows) await Business.updateOne({ _id: f.businessId, 'stats.followerCount': { $gt: 0 } }, { $inc: { 'stats.followerCount': -1 } }, { timestamps: false });
      const posts = await Post.find({ authorId: userId }, { media: 1 }).lean();
      destroyMedia(posts.flatMap((p) => (p.media ?? []).map((m) => m.publicId)));

      await Promise.all([
        Follow.deleteMany({ userId }), Save.deleteMany({ userId }), Vouch.deleteMany({ userId }), ReviewVote.deleteMany({ userId }),
        Rsvp.deleteMany({ userId }), Reaction.deleteMany({ userId }), Comment.deleteMany({ authorId: userId }),
        Post.deleteMany({ authorId: userId }), Notification.deleteMany({ userId }),
      ]);
      await User.deleteOne({ _id: userId });
    }
    // Anonymous reviews count with neutral credibility, so scores are recalculated.
    for (const id of touched) await recalcBusiness(id, undefined, now.getTime());
    return { purged: users.length, businessesRecalculated: touched.size };
  },
};
