/**
 * Tiny shared utility for the review/topRecommendation post-generation
 * guards (topRecommendationHelpers.ts, coachingHelpers.ts) — kept in its own
 * file rather than duplicated in both, since both need identical escaping
 * behavior for building word-boundary regexes from arbitrary label/category
 * strings (which may contain regex-special characters, e.g. "Groceries &
 * Pharmacy" or a French label with an apostrophe).
 */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
