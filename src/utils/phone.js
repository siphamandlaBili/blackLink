/**
 * South African numbers, stored as digits in international form: "27712345678".
 * Accepts "071 234 5678", "+27 71 234 5678", "0027712345678", "27712345678".
 * @returns {string|null}
 */
export function normalizeSaPhone(input = '') {
  const digits = String(input).replace(/\D/g, '').replace(/^00/, '');
  if (/^0[1-8]\d{8}$/.test(digits)) return `27${digits.slice(1)}`;
  if (/^27[1-8]\d{8}$/.test(digits)) return digits;
  return null;
}

/** Mobile numbers (06x, 07x, 08x) — WhatsApp needs one. */
export const isSaMobile = (normalized) => /^27[678]\d{8}$/.test(normalized ?? '');
