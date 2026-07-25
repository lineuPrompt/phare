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
