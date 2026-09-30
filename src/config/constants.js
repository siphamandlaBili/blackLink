/**
 * Domain constants shared by models, validators and services. Mirrors the frontend's
 * src/config so ids line up across client and server.
 */
export const CATEGORIES = [
  'food', 'spaza', 'hair', 'beauty', 'carwash', 'fashion', 'taverns', 'catering',
  'tours', 'creative', 'tech', 'health', 'home', 'education', 'transport',
];

export const TOWNSHIPS = [
  'orlando-east', 'orlando-west', 'diepkloof', 'meadowlands', 'dobsonville', 'pimville', 'kliptown', 'jabavu',
  'dube', 'mofolo', 'moroka', 'naledi', 'zola', 'chiawelo', 'protea-glen', 'emdeni',
];

export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
export const ROLES = ['customer', 'owner', 'admin'];
export const VERIFICATION_LEVELS = ['phone', 'vouched', 'registered'];
export const TRUST_TIERS = ['building', 'fair', 'good', 'trusted', 'high'];
export const PAYMENT_METHODS = ['cash', 'card', 'eft', 'snapscan', 'zapper', 'payshap'];
export const BUSINESS_STATUSES = ['draft', 'published', 'suspended', 'deleted'];
export const REVIEW_STATUSES = ['published', 'flagged', 'removed'];
export const REVIEW_TAGS = ['Friendly', 'Fair prices', 'On time', 'Clean', 'Great value', 'Slow service', 'Would return'];
export const REPORT_REASONS = ['fake', 'offensive', 'spam', 'conflict_of_interest', 'not_real_experience', 'auto_burst', 'auto_new_accounts', 'auto_duplicate', 'other'];
export const REPORT_STATUSES = ['open', 'kept', 'removed', 'dismissed'];
export const POST_TYPES = ['update', 'spotlight', 'thread', 'collab'];
export const EVENT_TYPES = ['market', 'shisanyama', 'music', 'heritage', 'workshop', 'stokvel'];
export const BADGES = ['early-linker', 'first-review', 'top-reviewer', 'trusted-local', 'local-champion'];
export const NOTIFICATION_TYPES = [
  'welcome', 'business_published', 'new_review', 'owner_reply', 'report_outcome', 'event_reminder', 'weekly_digest',
];
export const EMAIL_STATUSES = ['pending', 'sent', 'failed', 'skipped'];

/** Soweto's approximate bounding box, [lng, lat]. Seeded and user-dropped pins must fall inside. */
export const SOWETO_BOUNDS = { minLng: 27.78, maxLng: 27.98, minLat: -26.31, maxLat: -26.19 };

export const TIMEZONE = 'Africa/Johannesburg';
