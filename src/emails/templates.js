import { Layout, h } from './Layout.js';
import { CTA, Item, P, Quote, Title, stars } from './parts.js';

/*
 * The seven emails. Each entry: subject(props) and body(props), where body returns the
 * content placed inside the shared Layout. Props always include firstName and the links
 * built by services/email.js.
 */

const SAST = { timeZone: 'Africa/Johannesburg' };
const when = (d) =>
  new Date(d).toLocaleString('en-ZA', { ...SAST, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
const rand = (cents) => (cents ? `R ${String(Math.round(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}` : 'Free');

export const TEMPLATES = {
  welcome: {
    subject: () => 'Welcome to Black Link',
    body: (p) => [
      h(Title, { key: 't' }, `Sawubona ${p.firstName}, you’re linked in`),
      h(P, { key: 'p1' }, 'Black Link is where Soweto business links up. Find the spots around you, follow your favourites and leave honest reviews that help neighbours choose.'),
      h(P, { key: 'p2', muted: true }, 'Run a business? Listing it is free and takes about five minutes on your phone.'),
      h(CTA, { key: 'c', href: p.exploreUrl }, 'Find businesses near me'),
    ],
  },

  business_published: {
    subject: (p) => `${p.businessName} is live on Black Link`,
    body: (p) => [
      h(Title, { key: 't' }, 'Your listing is live'),
      h(P, { key: 'p1' }, `${p.businessName} can now be found by neighbours across Soweto. Share your profile on WhatsApp so your regulars can follow you and leave the first reviews.`),
      h(P, { key: 'p2', muted: true }, 'Tip: businesses with a cover photo and clear “How to find us” directions get more visits.'),
      h(CTA, { key: 'c', href: p.businessUrl }, 'View your listing'),
    ],
  },

  new_review: {
    subject: (p) => `New ${p.rating}★ review for ${p.businessName}`,
    body: (p) => [
      h(Title, { key: 't' }, `${p.reviewerName} reviewed ${p.businessName}`),
      h(P, { key: 's' }, stars(p.rating)),
      h(Quote, { key: 'q' }, p.excerpt),
      h(P, { key: 'p', muted: true }, 'A quick, friendly reply shows customers you listen, and it counts toward your Trust Score.'),
      h(CTA, { key: 'c', href: p.reviewUrl }, 'Reply to this review'),
    ],
  },

  owner_reply: {
    subject: (p) => `${p.businessName} replied to your review`,
    body: (p) => [
      h(Title, { key: 't' }, `${p.businessName} replied`),
      h(P, { key: 'p', muted: true }, 'Response from the owner:'),
      h(Quote, { key: 'q' }, p.replyText),
      h(CTA, { key: 'c', href: p.reviewUrl }, 'See the conversation'),
    ],
  },

  report_outcome: {
    subject: () => 'An update on your report',
    body: (p) => [
      h(Title, { key: 't' }, 'Thanks for your report'),
      h(P, { key: 'p1' }, p.outcome === 'removed' ? 'We reviewed the content you reported and removed it for breaking our community guidelines.' : 'We reviewed the content you reported. It doesn’t break our guidelines, so it stays up. Negative reviews are only removed when they break the rules.'),
      h(P, { key: 'p2', muted: true }, 'Reports like yours keep Black Link fair for everyone.'),
      h(CTA, { key: 'c', href: p.guidelinesUrl }, 'Read the review guidelines'),
    ],
  },

  event_reminder: {
    subject: (p) => `Reminder: ${p.eventTitle} is coming up`,
    body: (p) => [
      h(Title, { key: 't' }, `${p.eventTitle} is coming up`),
      h(Item, { key: 'w', name: when(p.startsAt), detail: `${p.venue} · ${rand(p.priceCents)}` }),
      h(P, { key: 'p', muted: true }, 'You said you’re going. Can’t make it any more? Let the host know by removing your RSVP so someone else can have the spot.'),
      h(CTA, { key: 'c', href: p.eventUrl }, 'View event'),
    ],
  },

  weekly_digest: {
    subject: () => 'Your kasi weekly',
    body: (p) => [
      h(Title, { key: 't' }, 'This week on Black Link'),
      p.newBusinesses?.length ? h(P, { key: 'nh', muted: true }, 'New in Soweto') : null,
      ...(p.newBusinesses ?? []).map((b, i) => h(Item, { key: `b${i}`, name: b.name, detail: b.detail, href: b.url })),
      p.events?.length ? h(P, { key: 'eh', muted: true }, 'Coming up') : null,
      ...(p.events ?? []).map((e, i) => h(Item, { key: `e${i}`, name: e.title, detail: `${when(e.startsAt)} · ${e.venue}`, href: e.url })),
      p.trending?.length ? h(P, { key: 'th', muted: true }, 'Trending') : null,
      ...(p.trending ?? []).map((b, i) => h(Item, { key: `t${i}`, name: b.name, detail: b.detail, href: b.url })),
      h(CTA, { key: 'c', href: p.exploreUrl }, 'Explore Black Link'),
    ],
  },
};

/** The full React element for a template, wrapped in the layout. */
export function emailElement(name, props) {
  const t = TEMPLATES[name];
  if (!t) throw new Error(`Unknown email template "${name}"`);
  return h(Layout, { preview: t.subject(props), unsubscribeUrl: props.unsubscribeUrl, preferencesUrl: props.preferencesUrl }, t.body(props));
}
