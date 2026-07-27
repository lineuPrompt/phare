/**
 * The Coaching Layer — pure, code-owned math for "which need to fund first,
 * where the money could realistically come from, and how much to start at."
 *
 * Same discipline as goalHelpers.ts: every number here is code-computed and
 * only narrated by the AI (regenerate-plan/route.ts). The AI is never asked
 * to choose a category or a priority — selectTopOverTargetCategory and
 * rankFundingNeeds make those choices in code, so a misbehaving AI has
 * nothing to fabricate: a category with no real overspend structurally
 * cannot reach computeOverTargetCategories' output, let alone the AI's
 * context.
 */

import { monthsBetween } from './goalHelpers';
import { escapeRegExp } from './textMatchHelpers';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// 1. Prioritization
// ---------------------------------------------------------------------------

export type FundingNeed =
  | {
      kind: 'sinkingFundAllocation';
      name: string;
      monthlyProvision: number;
      monthsUntilDue: number | null;
      // A sinking fund's due date recurs annually — there is no "past due"
      // state the way a goal has one. Always false; kept on the type so
      // rankFundingNeeds can treat both kinds uniformly.
      pastDue: false;
    }
  | {
      kind: 'goal';
      name: string;
      monthlyContribution: number;
      monthsToTarget: number | null;
      pastDue: boolean;
      amountRemaining: number;
    };

export type RankedNeed = FundingNeed & { monthlyPressure: number };

/**
 * Next occurrence of (dueMonth, dueDay) on/after today, wrapping to next
 * year if this year's date has already passed. null when dueMonth is unset
 * — never guessed.
 *
 * KNOWN LIMITATION: sinking funds share ONE buffer account (no per-fund
 * balance exists — see project memory), so there is no way to tell whether
 * THIS fund specifically is behind schedule. A fund whose due date already
 * passed this year while the shared buffer is unfunded simply rolls to
 * ~12 months out and ranks low, same as a fund that's genuinely not due for
 * a while — accepted for v1; would need per-fund balance tracking to fix,
 * which is a separate, unbuilt feature.
 */
export function computeSinkingFundUrgency(
  fund: { dueMonth: number | null; dueDay: number | null },
  today: string
): { monthsUntilDue: number | null } {
  if (!fund.dueMonth) return { monthsUntilDue: null };
  const day = fund.dueDay ?? 1;
  const [todayYear] = today.slice(0, 10).split('-').map(Number);
  const candidate = `${todayYear}-${String(fund.dueMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const dueYear = candidate < today ? todayYear + 1 : todayYear;
  const dueMonthStr = `${dueYear}-${String(fund.dueMonth).padStart(2, '0')}`;
  return { monthsUntilDue: monthsBetween(today, dueMonthStr) };
}

/**
 * Orders funding needs nearest-and-largest first:
 *   1. Any past-due item first (goals only — see pastDue note above).
 *   2. Ascending months-until-due/months-to-target (null — no date set — last).
 *   3. Ties broken by descending monthly pressure (larger need first).
 * Debts are NOT part of this list — see regenerate-plan/route.ts for why
 * (already-committed capacity, own dedicated payoff card).
 */
export function rankFundingNeeds(needs: FundingNeed[]): RankedNeed[] {
  const withPressure: RankedNeed[] = needs.map((n) => ({
    ...n,
    monthlyPressure: n.kind === 'sinkingFundAllocation' ? n.monthlyProvision : n.monthlyContribution,
  }));

  const monthsOf = (n: RankedNeed): number | null =>
    n.kind === 'sinkingFundAllocation' ? n.monthsUntilDue : n.monthsToTarget;

  return [...withPressure].sort((a, b) => {
    if (a.pastDue !== b.pastDue) return a.pastDue ? -1 : 1;
    const aMonths = monthsOf(a);
    const bMonths = monthsOf(b);
    if (aMonths === null && bMonths === null) return b.monthlyPressure - a.monthlyPressure;
    if (aMonths === null) return 1;
    if (bMonths === null) return -1;
    if (aMonths !== bMonths) return aMonths - bMonths;
    return b.monthlyPressure - a.monthlyPressure;
  });
}

// ---------------------------------------------------------------------------
// 2. Sourcing
// ---------------------------------------------------------------------------

export type TypicalSurplusInput = { month: string; netCashFlow: number; windfallExtra: number };
export type TypicalSurplusResult = { typicalSurplus: number; monthsUsed: number };

/**
 * Average of (netCashFlow − windfallExtra) over the given trailing months —
 * "typical" surplus with one-time windfalls netted back out so they never
 * inflate what looks like ongoing room. null only when zero months are
 * given (nothing to average). The caller (regenerate-plan/route.ts) always
 * supplies a fixed 3-month trailing window, excluding the current
 * in-progress month.
 */
export function computeTypicalSurplus(months: TypicalSurplusInput[]): TypicalSurplusResult | null {
  if (months.length === 0) return null;
  const adjusted = months.map((m) => m.netCashFlow - m.windfallExtra);
  const avg = adjusted.reduce((sum, v) => sum + v, 0) / adjusted.length;
  return { typicalSurplus: round2(avg), monthsUsed: months.length };
}

export type MonthHistoryAvailability = { month: string; hasRealData: boolean };

/**
 * True when fewer than 3 of the intended trailing months have any real
 * transaction data at all — e.g. a recently-onboarded household whose
 * ledger doesn't reach back that far. Deliberately separate from
 * fallbackApplies, which answers a different question ("is there nothing
 * anywhere to point to" — sourceCategory/freedCapacityEvents can be real
 * and present even when the trailing window itself is mostly empty). This
 * signal exists so a $0 typicalSurplus/startingContribution caused by thin
 * history can be explained honestly, rather than read as silent and
 * incoherent next to a genuinely strong current month. Does NOT change how
 * typicalSurplus itself is computed — an empty month legitimately
 * contributes 0 to that average, exactly as computeTypicalSurplus already
 * does; this is a separate narration signal, not a different formula.
 */
export function computeInsufficientHistory(months: MonthHistoryAvailability[]): boolean {
  const monthsWithData = months.filter((m) => m.hasRealData).length;
  return monthsWithData < 3;
}

export type OverTargetCategory = { categoryName: string; target: number; actual: number; over: number };

/**
 * A category qualifies ONLY when the family set a real target (target > 0
 * — never 0/unset) AND actual spend exceeds it. A category with no target,
 * or one that's under/at target, cannot appear here — there is no path for
 * it to reach this array, which is what makes it structurally impossible
 * for the AI to fabricate a "source" category later (see
 * selectTopOverTargetCategory and regenerate-plan/route.ts's coaching
 * block: the AI is only ever given the ONE category this function selects,
 * never the full list, and it never chooses it itself).
 *
 * CEILING (not a choice): targets only exist for card-envelope categories
 * today (card_envelope_items) — there's no chequing-side category target
 * anywhere in the schema. This can only ever surface card spending.
 */
export function computeOverTargetCategories(
  figures: { categoryName: string; target: number; actual: number }[]
): OverTargetCategory[] {
  return figures
    .filter((f) => f.target > 0 && f.actual > f.target)
    .map((f) => ({ ...f, over: round2(f.actual - f.target) }));
}

/** Deterministic, code-only choice — the largest overspend. null if none qualify. */
export function selectTopOverTargetCategory(categories: OverTargetCategory[]): OverTargetCategory | null {
  if (categories.length === 0) return null;
  return categories.reduce((best, c) => (c.over > best.over ? c : best));
}

export type FreedCapacityEvent =
  | { kind: 'debtPayoff'; label: string; amount: number; freesOn: string /* YYYY-MM */ }
  | { kind: 'endingInstallment'; label: string; amount: number; freesOn: string /* YYYY-MM-DD */ };

/**
 * Real, dated events that will free up capacity — never a made-up schedule.
 * debtPayoff comes straight from computeDebtPayoff (goalHelpers.ts), zero
 * new math. Ending installments come from real materialized rows sharing a
 * recurrence_id — each row already carries its own real date, so the last
 * (max-date) row per series IS the honest end date; only kept if that date
 * is still in the future (a series that already ended frees nothing new).
 */
export function computeFreedCapacityEvents(
  debtPayoff: { description: string; targetDate: string; monthlyPayment: number } | null,
  endingInstallments: { description: string; amount: number; lastDate: string }[]
): FreedCapacityEvent[] {
  const events: FreedCapacityEvent[] = [];
  if (debtPayoff) {
    events.push({
      kind: 'debtPayoff',
      label: debtPayoff.description,
      amount: debtPayoff.monthlyPayment,
      freesOn: debtPayoff.targetDate,
    });
  }
  for (const inst of endingInstallments) {
    events.push({
      kind: 'endingInstallment',
      label: inst.description,
      amount: round2(inst.amount),
      freesOn: inst.lastDate,
    });
  }
  return events;
}

/**
 * Groups installment rows (transactions with a non-null recurrence_id AND
 * installment_label — the label alone is cosmetic "N/Total" text, the
 * recurrence_id is what actually ties a series together) by recurrence_id
 * and keeps the real last date per series. Callers should filter to
 * lastDate > today themselves (this function only groups; regenerate-plan/
 * route.ts does the today-cutoff since it's the one that knows today).
 */
export function groupInstallmentSeries(
  rows: { recurrence_id: string | null; installment_label: string | null; description: string | null; amount: number | string; date: string }[]
): { description: string; amount: number; lastDate: string }[] {
  const groups = new Map<string, { description: string; amount: number; lastDate: string }>();
  for (const r of rows) {
    if (!r.recurrence_id || !r.installment_label) continue;
    const existing = groups.get(r.recurrence_id);
    if (!existing || r.date > existing.lastDate) {
      groups.set(r.recurrence_id, {
        description: r.description ?? '',
        amount: Number(r.amount),
        lastDate: r.date,
      });
    }
  }
  return Array.from(groups.values());
}

// ---------------------------------------------------------------------------
// 3. Ramping
// ---------------------------------------------------------------------------

/**
 * Starting contribution: never more than the top-ranked need actually
 * requires, and never more than typicalSurplus (which already has
 * committed transfers and windfalls netted out — genuinely uncommitted
 * room, not a figure to add anything on top of). No cushion applied
 * (founder decision, 2026-07-25) — typicalSurplus already being an average
 * is itself the only "margin" here.
 */
export function computeStartingContribution(
  topNeed: RankedNeed | null,
  typicalSurplus: number | null
): number {
  if (!topNeed || typicalSurplus === null) return 0;
  return round2(Math.min(topNeed.monthlyPressure, Math.max(0, typicalSurplus)));
}

/**
 * True only when there is genuinely nothing honest to point to: no source
 * category, no freed-capacity event, and typical surplus is null or not
 * positive. This is a MEANING constraint passed to the AI (coaching.
 * fallbackApplies), not fixed copy — the review prompt requires the model
 * to state plainly, in its own words, that there's no clear extra room and
 * to start small / revisit later, without inventing a source or reaching
 * for a vaguer instruction like "look at your spending."
 */
export function coachingFallbackApplies(ctx: {
  typicalSurplus: number | null;
  sourceCategory: OverTargetCategory | null;
  freedCapacityEvents: FreedCapacityEvent[];
}): boolean {
  const noSurplus = ctx.typicalSurplus === null || ctx.typicalSurplus <= 0;
  return noSurplus && ctx.sourceCategory === null && ctx.freedCapacityEvents.length === 0;
}

// ---------------------------------------------------------------------------
// Post-generation guard: category-sourcing leak (Fix 3, 2026-07-28)
// ---------------------------------------------------------------------------
//
// CONFIRMED LIVE (2026-07-28): plan.seedCategories and plan.monthlyBudget.
// categories reach reviewPrompt in full regardless of coaching.sourceCategory
// — a real data leak. Two live adversarial attempts (including Shopping at
// 60% of income, no target at all) did not get the model to exploit it, but
// "not yet observed" isn't "impossible" — this is a defense-in-depth net,
// not the primary gate (the primary gate is still that sourceCategory itself
// is the only category-with-real-overspend data the AI is fed for sourcing
// purposes; this catches the case where the model reaches for a category
// name from the wider budget/seed list anyway).
//
// Phrases the reviewPrompt itself teaches as the canonical way to describe
// the ONE sanctioned money source (e.g. "that's one place it could come
// from"). A DISALLOWED category name appearing shortly AFTER one of these
// phrases means the model used a category outside coaching.sourceCategory
// as a money source — a category mentioned purely as budget narration (no
// sourcing phrase immediately before it) is not flagged, since that's
// legitimate and happens in nearly every real review.
const SOURCING_PHRASE_MARKERS_EN = [
  'could come from',
  'come from',
  'consider directing',
  'consider moving',
  'pull from',
  'move money from',
  'take from',
  'cut back on',
  'reduce spending on',
  'use that room',
  'room in',
];

// PROXIMITY FIX (2026-07-28, Codex finding 5ii): confirmed false positive —
// sourceCategory:null, "There is room in your budget to keep shopping
// around for lower insurance premiums." tripped this guard, pairing "room
// in" with "Shopping" (the SEED category) even though the sentence never
// names a category as a source at all — "shopping" here is the ordinary verb
// ("shop around for a better rate"), 21 characters after "room in" with
// "your budget to keep " in between. Measured empirically against every
// real true-positive phrasing already covered by tests: the sourcing phrase
// always ends within 1-12 characters of the category name it actually
// introduces (e.g. "pull from Groceries & Pharmacy", "consider directing
// money from Shopping"). SOURCING_PROXIMITY_CHARS sits comfortably inside
// that gap, with margin on both sides. Also fixed: category names are now
// matched by whole word (word-boundary regex, matchAll for every
// occurrence), not by unbounded substring — "shopping" the verb and
// "Shopping" the category are literally the same word, so word-boundary
// alone doesn't fully separate them; requiring genuine PHRASE-then-CATEGORY
// adjacency is what actually distinguishes "used as a source" from
// "happened to appear nearby."
const SOURCING_PROXIMITY_CHARS = 15;

/**
 * Scans reviewText for a disallowed category name appearing shortly after
 * one of the canonical sourcing phrases — a genuine "phrase introduces this
 * category as a source" construction, not mere co-occurrence anywhere in a
 * wide window. Returns the first offending category name, or null if none
 * found. `allowedCategoryName` (coaching.sourceCategory's own name, or null
 * when there is none) is exempt — the model IS allowed to describe that one
 * as a source, per the prompt's COACHING rule.
 */
export function findUnsanctionedSourcingMention(
  reviewText: string,
  allCategoryNames: string[],
  allowedCategoryName: string | null,
  sourcingPhrases: string[] = SOURCING_PHRASE_MARKERS_EN
): string | null {
  const lowerText = reviewText.toLowerCase();

  const phraseEnds: number[] = [];
  for (const phrase of sourcingPhrases) {
    for (const m of lowerText.matchAll(new RegExp(escapeRegExp(phrase), 'g'))) {
      if (m.index !== undefined) phraseEnds.push(m.index + phrase.length);
    }
  }
  if (phraseEnds.length === 0) return null;

  for (const name of allCategoryNames) {
    if (allowedCategoryName && name.toLowerCase() === allowedCategoryName.toLowerCase()) continue;
    const nameRe = new RegExp(`\\b${escapeRegExp(name.toLowerCase())}\\b`, 'g');
    for (const m of lowerText.matchAll(nameRe)) {
      if (m.index === undefined) continue;
      const nameStart = m.index;
      const nearPhrase = phraseEnds.some((end) => {
        const gap = nameStart - end;
        return gap >= 0 && gap <= SOURCING_PROXIMITY_CHARS;
      });
      if (nearPhrase) return name;
    }
  }
  return null;
}

/**
 * Deterministic, minimal fallback used only when both the original
 * generation AND one retry still contain an unsanctioned category-sourcing
 * mention — a rare path (not observed in any live sample so far). Keeps the
 * family from ever seeing a review that names an unproven source; the
 * figures elsewhere on the dashboard (goals, sinking funds, snapshot) remain
 * accurate regardless of this text.
 */
export function buildFallbackReviewText(reviewMonthName: string, locale: 'en' | 'fr'): string {
  return locale === 'fr'
    ? `La revue complète de ${reviewMonthName} n'a pas pu être générée de façon fiable cette fois-ci — les chiffres affichés ailleurs restent exacts, et une nouvelle revue sera prête la prochaine fois que vous régénérerez.`
    : `${reviewMonthName}'s full review couldn't be generated safely this time — the figures shown elsewhere are still accurate, and a fresh review will be ready the next time you regenerate.`;
}

/**
 * True when `text` contains a literal "{tokenName}" for any of the given
 * illustrative example token names — the model echoing reviewPrompt's own
 * few-shot example syntax verbatim instead of substituting a real value
 * (same failure class as the {{DEBT_PAYMENT}} leak, single-brace
 * convention; this model has previously been observed narrating a few-shot
 * example's own details as if they were real — see the "Good tone" month
 * example fix, Build 4 Part B — so echoing "{name}"/"{month}" literally is
 * a real, not merely theoretical, risk).
 *
 * Deliberately NOT a generic /\{[^}]+\}/ scan — a single brace can
 * legitimately appear in prose or in a user-defined category name (e.g. a
 * category literally named "Fun {Money}"), and a false positive there would
 * discard a valid review. Only the SPECIFIC, enumerated names the caller
 * passes in are checked — regenerate-plan/route.ts defines and owns that
 * list immediately next to reviewPrompt's own text, so a new illustrative
 * placeholder added to the prompt later makes the omission here obvious
 * (a missing entry in one small, visible array) rather than silent.
 *
 * EXEMPTION (2026-07-28, Codex finding 5i): if a family's own real sinking
 * fund/goal name literally IS "{name}" (an odd but legitimate choice — a
 * literal brace character in a chosen name), the matching text is real, not
 * a leak. `realEntityNames` is the household's actual fund/goal names for
 * this review; a candidate token is only flagged when it does NOT match one
 * of them exactly. Defaults to empty (nothing exempted) so existing callers
 * that don't have this data are unaffected.
 */
export function containsIllustrativeTokenLeak(
  text: string,
  tokenNames: readonly string[],
  realEntityNames: string[] = []
): boolean {
  return tokenNames.some((name) => {
    const token = `{${name}}`;
    if (!text.includes(token)) return false;
    return !realEntityNames.includes(token);
  });
}
