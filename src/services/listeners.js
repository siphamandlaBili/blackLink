import { env } from '../config/env.js';
import { Business, User } from '../models/index.js';
import { on } from './events.js';
import { notify } from './notifications.js';

/*
 * Turns domain events into notifications. Registered once, when this module is first
 * imported (app.js). Each notification has a dedupeKey, so a repeated event is harmless.
 */
const app = (path) => `${env.CLIENT_URL}${path}`;
const excerpt = (text, n = 220) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

on('user.created', async ({ user }) => {
  await notify({
    userId: user._id,
    type: 'welcome',
    title: 'Welcome to Black Link',
    body: 'Find, follow and review the businesses around you.',
    link: '/explore',
    dedupeKey: `welcome:${user._id}`,
    email: { template: 'welcome', props: {} },
  });
});

on('business.published', async ({ business }) => {
  await notify({
    userId: business.ownerId,
    type: 'business_published',
    title: `${business.name} is live`,
    body: 'Share your profile so your regulars can follow you.',
    link: `/business/${business.slug}`,
    data: { businessId: String(business._id) },
    dedupeKey: `business_published:${business._id}`,
    email: { template: 'business_published', props: { businessName: business.name, businessUrl: app(`/business/${business.slug}`) } },
  });
});

on('review.created', async ({ review, business }) => {
  const [owner, reviewer] = await Promise.all([
    Business.findById(business._id, { ownerId: 1 }).lean(),
    User.findById(review.authorId, { displayName: 1 }).lean(),
  ]);
  if (!owner?.ownerId) return;
  const link = `/business/${business.slug}#review-${review._id}`;
  await notify({
    userId: owner.ownerId,
    type: 'new_review',
    title: `New ${review.rating}★ review for ${business.name}`,
    body: excerpt(review.text, 140),
    link,
    data: { businessId: String(business._id), reviewId: String(review._id) },
    dedupeKey: `new_review:${review._id}`,
    email: {
      template: 'new_review',
      props: { businessName: business.name, reviewerName: reviewer?.displayName ?? 'A customer', rating: review.rating, excerpt: excerpt(review.text), reviewUrl: app(link) },
    },
  });
});

on('review.replied', async ({ review, business }) => {
  if (!review.authorId) return;
  const link = `/business/${business.slug}#review-${review._id}`;
  await notify({
    userId: review.authorId,
    type: 'owner_reply',
    title: `${business.name} replied to your review`,
    body: excerpt(review.ownerReply.text, 140),
    link,
    data: { businessId: String(business._id), reviewId: String(review._id) },
    dedupeKey: `owner_reply:${review._id}`,
    email: { template: 'owner_reply', props: { businessName: business.name, replyText: excerpt(review.ownerReply.text, 500), reviewUrl: app(link) } },
  });
});

// Emitted by the admin moderation queue (Phase 7) when a member's report is resolved.
on('report.resolved', async ({ report, outcome }) => {
  if (!report.reporterId) return;
  await notify({
    userId: report.reporterId,
    type: 'report_outcome',
    title: 'An update on your report',
    body: outcome === 'removed' ? 'We removed the content you reported.' : 'We reviewed your report; the content stays up.',
    link: '/review-guidelines',
    data: { reportId: String(report._id), outcome },
    dedupeKey: `report_outcome:${report._id}`,
    email: { template: 'report_outcome', props: { outcome } },
  });
});
