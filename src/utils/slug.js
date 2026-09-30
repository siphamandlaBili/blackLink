/** "Mam Zodwa's Spaza & More" → "mam-zodwas-spaza-and-more" */
export const slugify = (value = '') =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);

/**
 * A slug that doesn't exist yet: "name", then "name-2", "name-3", …
 * @param {string} base
 * @param {(slug: string) => Promise<boolean>} exists
 */
export async function uniqueSlug(base, exists) {
  const root = slugify(base) || 'business';
  if (!(await exists(root))) return root;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${Date.now().toString(36)}`;
}

/** Public display name: first name + last initial, "Thabo M." */
export const displayNameOf = (firstName = '', lastName = '') =>
  `${firstName.trim()} ${lastName.trim() ? `${lastName.trim()[0].toUpperCase()}.` : ''}`.trim() || 'Member';
