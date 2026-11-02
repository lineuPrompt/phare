import { reviewForEntitlement } from '@/lib/reviewPreview';

// ---------------------------------------------------------------------------
// THE REVIEW ARCHIVE — turning a flat `conversations` list into the shape the
// Reviews page renders.
//
// ONE REVIEW PER MONTH, PLUS THE STARTING PLAN. Nothing else is rendered.
//
//   MONTHED (review_month set)   The month's letter. Since 2026-11-02 a month
//                                can hold two rows, one per writer (unique on
//                                household, month and generated_by): the
//                                month-end letter (cron) and the household's
//                                own refresh (manual). The month-end letter is
//                                THE letter; the refresh is kept and shown
//                                beneath it (Lineu: "keep both"). A month with
//                                only a refresh (the month in progress) shows
//                                the refresh as its letter, as before.
//   onboarding                   The letter written when the plan was first
//                                saved. Not a review of a month; exempt.
//   UNMONTHED monthly_review     LEGACY ONLY, and deliberately NOT RENDERED.
//
// WHY UNMONTHED ROWS ARE DROPPED RATHER THAN PLACED. Before regenerate-plan
// wrote a month, every refresh created a row with review_month NULL. A few
// presses produced a list that read as noise, which is what retired the
// "Earlier" group. They cannot be folded into months either: inferring a
// refresh's month from its created_at is wrong the moment anyone regenerates
// twice in a month, and a letter filed under the wrong month is worse than one
// not shown — the reader has no way to notice.
//
// They are dropped from the ARCHIVE, not from the database. The dashboard still
// picks the newest conversation of any kind, so a pre-cutover household keeps
// seeing its most recent refresh there rather than falling back to its
// onboarding letter.
//
// THE FIGURE ON EACH ROW IS CODE-COMPUTED AND PASSED IN. It is never read out
// of the letter's prose. The letter is what the model wrote about the month;
// the figure is what the ledger says about it, and the whole point of showing
// them together is that they are independently sourced.
// ---------------------------------------------------------------------------

/** The `conversations` columns the archive needs. */
export type ArchiveConversation = {
  id: string;
  type: string;
  review_month: string | null;
  created_at: string;
  messages: unknown;
  /** 'cron' (month-end), 'manual' (a refresh), or null on legacy rows. */
  generated_by?: string | null;
};

export type ArchiveLetter = {
  id: string;
  createdAt: string;
  /**
   * Never gated. One sentence, and the daily value of the free tier — the
   * dashboard makes the same call for the same reason.
   */
  topRecommendation: string | null;
  /**
   * ALREADY TRUNCATED for a free household by the time it leaves the server.
   * The full text is not withheld from the component, it is absent from the
   * payload — see reviewPreview.ts.
   */
  review: string | null;
  reviewLocked: boolean;
};

export type ArchiveMonth = {
  /** 'YYYY-MM'. */
  month: string;
  /**
   * Net cash flow for the month from the ledger, or null when the month has no
   * transactions at all. Null renders as a dash — never as $0, which is a real
   * figure and would be a lie about an empty month.
   */
  netCashFlow: number | null;
  /** The month's letter: the month-end one when it exists. See the header. */
  letter: ArchiveLetter;
  /**
   * The household's own refresh for this month, kept beside the month-end
   * letter. Null when there is none, or when the refresh IS `letter` (the
   * month has no month-end letter yet).
   */
  refresh: ArchiveLetter | null;
};

export type ReviewArchive = {
  /** Newest month first. */
  months: ArchiveMonth[];
  /** The cold-start baseline. See pickStartingPlan. */
  startingPlan: ArchiveLetter | null;
};

type StoredMessage = { role?: string; type?: string; content?: string; locale?: string };

/**
 * Pulls the two message bodies out of a conversation row.
 *
 * Tolerant by design: an EMPTY messages array is a real state, not corruption
 * — the cron inserts its claim before generating, so a row observed mid-run has
 * `messages: []`. Such a row yields a letter with null content, which the page
 * filters out rather than rendering as a blank entry.
 */
export function extractLetter(row: ArchiveConversation, isPro: boolean): ArchiveLetter {
  const messages = Array.isArray(row.messages) ? (row.messages as StoredMessage[]) : [];
  const full = messages.find((m) => m?.type === 'monthly_review')?.content ?? null;
  const rec = messages.find((m) => m?.type === 'top_recommendation')?.content ?? null;

  const { review, reviewLocked } = reviewForEntitlement(full, isPro);

  return {
    id: row.id,
    createdAt: row.created_at,
    topRecommendation: rec,
    review: review || null,
    reviewLocked,
  };
}

/** A letter with no content at all — an in-flight claim, or a row that lost its text. */
function isEmpty(letter: ArchiveLetter): boolean {
  return !letter.review && !letter.topRecommendation;
}

/** Newest first. */
function byCreatedAtDesc(a: ArchiveLetter, b: ArchiveLetter): number {
  return b.createdAt.localeCompare(a.createdAt);
}

/**
 * Which onboarding row is "Your starting plan"?
 *
 * The EARLIEST one. save-plan inserts an onboarding letter on every plan save,
 * so a household that re-uploaded its budget has several — and the cold-start
 * baseline is the first one, the letter written when they had no history at
 * all.
 *
 * `rest` (the later re-uploads) is returned but no longer rendered: with the
 * "Earlier" group retired there is nowhere for them to go that would not
 * reintroduce the noise it was retired for. It stays on the return type
 * because it is exactly the set the cleanup script deletes, and a caller that
 * wants to count or surface them should not have to re-derive it.
 */
export function pickStartingPlan(onboardingLetters: ArchiveLetter[]): {
  startingPlan: ArchiveLetter | null;
  rest: ArchiveLetter[];
} {
  if (onboardingLetters.length === 0) return { startingPlan: null, rest: [] };

  const sorted = [...onboardingLetters].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { startingPlan: sorted[0], rest: sorted.slice(1) };
}

export function groupReviewArchive(
  rows: ArchiveConversation[],
  options: { isPro: boolean; figures?: Record<string, number | null> }
): ReviewArchive {
  const { isPro, figures = {} } = options;

  const monthEnd = new Map<string, ArchiveLetter[]>();
  const refreshes = new Map<string, ArchiveLetter[]>();
  const onboarding: ArchiveLetter[] = [];

  for (const row of rows) {
    const letter = extractLetter(row, isPro);
    // An empty claim is not a letter. Rendering one would show the household a
    // dated entry that opens onto nothing.
    if (isEmpty(letter)) continue;

    if (row.type === 'onboarding') {
      onboarding.push(letter);
      continue;
    }
    // Legacy unmonthed refresh — see the header. Skipped, not placed.
    if (!row.review_month) continue;

    // Legacy rows (generated_by null) were month-end letters (20260810).
    const bucket = row.generated_by === 'manual' ? refreshes : monthEnd;
    const list = bucket.get(row.review_month) ?? [];
    list.push(letter);
    bucket.set(row.review_month, list);
  }

  // Newest of each kind. The unique index allows one of each per month going
  // forward; sorting is a belt-and-braces read for rows predating it.
  const newest = (letters: ArchiveLetter[] | undefined) =>
    letters && letters.length > 0 ? [...letters].sort(byCreatedAtDesc)[0] : null;

  const allMonths = new Set([...monthEnd.keys(), ...refreshes.keys()]);
  const months: ArchiveMonth[] = [...allMonths]
    .map((month) => {
      const end = newest(monthEnd.get(month));
      const refresh = newest(refreshes.get(month));
      return {
        month,
        netCashFlow: figures[month] ?? null,
        letter: (end ?? refresh) as ArchiveLetter,
        refresh: end ? refresh : null,
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month));

  return { months, startingPlan: pickStartingPlan(onboarding).startingPlan };
}

/** 'YYYY-MM' → 'August 2026' / 'août 2026'. */
export function formatArchiveMonth(month: string, locale: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return month;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  return date.toLocaleDateString(locale === 'fr' ? 'fr-CA' : 'en-CA', {
    year: 'numeric',
    month: 'long',
  });
}

/** Every distinct month the archive needs a ledger figure for. */
export function monthsNeedingFigures(rows: ArchiveConversation[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.type !== 'onboarding' && row.review_month) set.add(row.review_month);
  }
  return [...set].sort();
}
