import { apiGet } from './api';

// ---------------------------------------------------------------------------
// GET /api/reviews — the household's letters.
//
// These types mirror src/lib/reviewArchive.ts's ArchiveLetter / ArchiveMonth /
// ReviewArchive exactly. They are re-declared rather than imported because
// @phare/core is the only package the web app and this one share, and those
// types live in the web app's src/, which mobile must not reach into. If the
// route's response shape becomes something more than one screen depends on,
// moving these into @phare/core is the right move — that is a change to a
// shared package and needs saying out loud first.
//
// THE PAYWALL IS ALREADY APPLIED by the time this arrives. For a free
// household the server truncates `review` and sets `reviewLocked: true`; the
// rest of the letter is ABSENT from the payload, not hidden inside it. The
// client therefore cannot leak it and must not try to imply what is missing.
// ---------------------------------------------------------------------------

export type ArchiveLetter = {
  id: string;
  createdAt: string;
  /** Never gated — the free tier's daily value. */
  topRecommendation: string | null;
  /** Already truncated for a free household. */
  review: string | null;
  reviewLocked: boolean;
};

export type ArchiveMonth = {
  /** 'YYYY-MM'. */
  month: string;
  /**
   * Null when the month has no transactions at all. Renders as a dash, never
   * as $0 — that is a real figure and would be a lie about an empty month.
   */
  netCashFlow: number | null;
  letter: ArchiveLetter;
};

export type ReviewArchive = {
  /** Newest month first. */
  months: ArchiveMonth[];
  startingPlan: ArchiveLetter | null;
  isPro: boolean;
};

export function fetchReviews(): Promise<ReviewArchive> {
  return apiGet<ReviewArchive>('/api/reviews');
}
