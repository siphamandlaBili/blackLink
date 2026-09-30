import mongoose from 'mongoose';
import { BADGES, CATEGORIES, ROLES } from '../config/constants.js';
import { baseOptions } from './shared.js';

const { Schema } = mongoose;

/**
 * @typedef {Object} UserDoc
 * @property {import('mongoose').Types.ObjectId} _id
 * @property {string|null} clerkId     Clerk user id. Null only for seeded demo users.
 * @property {string} email            Private. Never in public responses.
 * @property {boolean} emailVerified
 * @property {string} firstName
 * @property {string} lastName
 * @property {string} displayName      Public name: first name + last initial, e.g. "Thabo M."
 * @property {string|null} avatarUrl
 * @property {'customer'|'owner'|'admin'} role
 * @property {string[]} badges
 * @property {number} reviewCount
 * @property {number} helpfulVotesReceived
 * @property {number} credibility      0–1, feeds Trust Score reviewer credibility.
 * @property {{ categories: string[], radiusKm: number, language: string, notifications: Object }} preferences
 * @property {{ township?: string, lat?: number, lng?: number }} area  Rounded (~1 km) only, never precise.
 * @property {'active'|'suspended'|'deleted'} status
 * @property {Date|null} deletedAt     Soft delete; personal data purged 30 days later.
 */
const userSchema = new Schema(
  {
    clerkId: { type: String, default: null },
    email: { type: String, required: true, lowercase: true, trim: true },
    emailVerified: { type: Boolean, default: false },
    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, default: '', trim: true, maxlength: 60 },
    displayName: { type: String, required: true, trim: true, maxlength: 64 },
    avatarUrl: { type: String, default: null },
    role: { type: String, enum: ROLES, default: 'customer' },
    badges: { type: [{ type: String, enum: BADGES }], default: [] },
    reviewCount: { type: Number, default: 0, min: 0 },
    helpfulVotesReceived: { type: Number, default: 0, min: 0 },
    credibility: { type: Number, default: 0.5, min: 0, max: 1 },
    preferences: {
      categories: { type: [{ type: String, enum: CATEGORIES }], default: [] },
      radiusKm: { type: Number, default: 2, min: 0.5, max: 20 },
      language: { type: String, enum: ['en', 'zu', 'st', 'tn', 'xh'], default: 'en' },
      notifications: {
        newReview: { type: Boolean, default: true },
        ownerReply: { type: Boolean, default: true },
        eventReminders: { type: Boolean, default: true },
        weeklyDigest: { type: Boolean, default: false },
        product: { type: Boolean, default: true },
      },
    },
    area: {
      township: { type: String, default: null },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
    suspendedReason: { type: String, default: null, select: false },
    deletedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: null },
  },
  baseOptions,
);

// One Mongo user per Clerk user. Sparse so seeded demo users (no Clerk account) can coexist.
userSchema.index({ clerkId: 1 }, { unique: true, partialFilterExpression: { clerkId: { $type: 'string' } } });
// Emails are unique among live accounts; a deleted account's email can sign up again.
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { status: { $in: ['active', 'suspended'] } } });
userSchema.index({ role: 1, status: 1 });
// Nightly purge job: soft-deleted accounts older than 30 days.
userSchema.index({ status: 1, deletedAt: 1 });
// Leaderboards / top reviewers.
userSchema.index({ helpfulVotesReceived: -1 });

export const User = mongoose.model('User', userSchema);
