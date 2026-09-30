import { logger } from '../utils/logger.js';
import { AuditLog } from './AuditLog.js';
import { Business } from './Business.js';
import { BusinessStatsDaily } from './BusinessStatsDaily.js';
import { Comment } from './Comment.js';
import { Event } from './Event.js';
import { Follow } from './Follow.js';
import { HeritageSite } from './HeritageSite.js';
import { JobRun } from './JobRun.js';
import { Notification } from './Notification.js';
import { Offer } from './Offer.js';
import { Post } from './Post.js';
import { Reaction } from './Reaction.js';
import { Report } from './Report.js';
import { Review } from './Review.js';
import { ReviewVote } from './ReviewVote.js';
import { Rsvp } from './Rsvp.js';
import { Save } from './Save.js';
import { User } from './User.js';
import { Vouch } from './Vouch.js';
import { WebhookEvent } from './WebhookEvent.js';

export {
  AuditLog, Business, BusinessStatsDaily, Comment, Event, Follow, HeritageSite, JobRun, Notification,
  Offer, Post, Reaction, Report, Review, ReviewVote, Rsvp, Save, User, Vouch, WebhookEvent,
};

export const ALL_MODELS = [
  User, Business, Review, ReviewVote, Report, Follow, Save, Vouch, Post, Comment, Reaction,
  Event, Rsvp, Offer, HeritageSite, Notification, BusinessStatsDaily, AuditLog, WebhookEvent, JobRun,
];

/**
 * Makes the database's indexes match the model definitions: creates missing ones and
 * drops ones no longer declared. Safe to run on every start.
 */
export async function syncIndexes() {
  for (const model of ALL_MODELS) {
    await model.syncIndexes();
  }
  logger.info({ collections: ALL_MODELS.length }, 'Indexes in sync');
}
