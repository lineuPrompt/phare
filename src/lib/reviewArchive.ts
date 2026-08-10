import { reviewForEntitlement } from '@/lib/reviewPreview';

// ---------------------------------------------------------------------------
// THE REVIEW ARCHIVE — turning a flat `conversations` list into the shape the
// Reviews page renders.
//
// Three kinds of row land in `conversations`, and they are NOT interchangeable:
//
//   MONTHED (review_month set)   The canonical monthly letter, written by the
//                                cron. Exactly one per month — the partial
//                                unique index on (household_id, review_month)
//                                is what guarantees it.
//   UNMONTHED monthly_review     An on-demand refresh from POST
//                                /api/regenerate-plan, which deliberately
//                                leaves review_month NULL so pressing
//                                Regenerate can never collide with the cron.
//   onboarding                   The letter written when the plan was first
//                                saved.
//
// WHY UNMONTHED ROWS ARE NOT SORTED INTO MONTHS. It is tempting to infer a
// refresh's month from its created_at — "generated in August, so it describes
// July". That inference is wrong the moment anyone regenerates twice in a
// month, or regenerates in the same month the letter describes, and a review
// filed under the wrong month is worse than one filed under none: the reader
// has no way to notice. So they group under "Earlier", with their date, and
// claim nothing about which month they cover.
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
  latest: ArchiveLetter;
  /**
   * Superseded letters for the SAME month, newest first. Normally empty: the
   * unique index permits one monthed row per month. It is not guaranteed empty
   * — rows predating the index, or a month whose claim was reclaimed and
   * regenerated — so the page keeps them reachable rather than dropping them.
   */
  earlier: ArchiveLetter[];
};

export type ReviewArchive = {
  /** Newest month first. */
  months: ArchiveMonth[];
  /** Unmonthed letters, newest first. Claims no month — see the header. */
  earlier: ArchiveLetter[];
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
 * all. Later re-uploads are real letters and are not discarded; they fall
 * through to "Earlier" with the regenerations, which is where any unmonthed
 * letter belongs.
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

  const monthed = new Map<string, ArchiveLetter[]>();
  const unmonthed: ArchiveLetter[] = [];
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
    if (row.review_month) {
      const list = monthed.get(row.review_month) ?? [];
      list.push(letter);
      monthed.set(row.review_month, list);
      continue;
    }
    unmonthed.push(letter);
  }

  const months: ArchiveMonth[] = [...monthed.entries()]
    .map(([month, letters]) => {
      const sorted = letters.sort(byCreatedAtDesc);
      return {
        month,
        netCashFlow: figures[month] ?? null,
        latest: sorted[0],
        earlier: sorted.slice(1),
      };
    })
    .sort((a, b) => b.month.localeCompare(a.month));

  const { startingPlan, rest } = pickStartingPlan(onboarding);

  return {
    months,
    earlier: [...unmonthed, ...rest].sort(byCreatedAtDesc),
    startingPlan,
  };
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
