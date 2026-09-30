/**
 * Response shapes. Public serializers are the only way documents leave the API, and they
 * copy fields by name (an allowlist), so a new private field can never leak by accident.
 * Never public: email, phone numbers of users, clerkId, cipcNumber, exact user locations,
 * status flags, textHash, credibility.
 */

const id = (v) => (v ? String(v) : null);

/** Another member as anyone may see them, e.g. a review author. */
export function userToPublic(u) {
  if (!u) return { id: null, displayName: 'Former member', avatarUrl: null, badges: [], reviewCount: 0 };
  return {
    id: id(u._id),
    displayName: u.displayName,
    avatarUrl: u.avatarUrl ?? null,
    badges: u.badges ?? [],
    reviewCount: u.reviewCount ?? 0,
    helpfulVotesReceived: u.helpfulVotesReceived ?? 0,
  };
}

/** The signed-in user's own account (GET /api/me). Includes their own email; never clerkId. */
export function userToSelf(u) {
  return {
    ...userToPublic(u),
    email: u.email,
    emailVerified: u.emailVerified,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role,
    preferences: {
      categories: u.preferences?.categories ?? [],
      radiusKm: u.preferences?.radiusKm ?? 2,
      language: u.preferences?.language ?? 'en',
      notifications: { ...u.preferences?.notifications },
    },
    // Only ever the rounded area the user chose to remember.
    area: { township: u.area?.township ?? null, lat: u.area?.lat ?? null, lng: u.area?.lng ?? null },
    createdAt: u.createdAt,
  };
}
