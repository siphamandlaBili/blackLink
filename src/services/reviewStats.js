/**
 * Review aggregates stored on the business (stats.rating, distribution, sub-rating
 * averages). Pure, like trustScore.js; the review service wraps both in a transaction.
 * @param {Array<{ rating: number, subRatings?: Object }>} reviews Published reviews only.
 */
export function computeReviewStats(reviews) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const subs = { service: [], quality: [], value: [], reliability: [] };
  let sum = 0;
  for (const r of reviews) {
    distribution[r.rating] += 1;
    sum += r.rating;
    for (const key of Object.keys(subs)) {
      const v = r.subRatings?.[key];
      if (typeof v === 'number') subs[key].push(v);
    }
  }
  const avg = (list) => (list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10 : undefined);
  return {
    rating: reviews.length ? Math.round((sum / reviews.length) * 10) / 10 : 0,
    reviewCount: reviews.length,
    distribution,
    subRatings: Object.fromEntries(Object.entries(subs).map(([k, v]) => [k, avg(v)])),
  };
}
