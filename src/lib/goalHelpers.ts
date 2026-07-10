/**
 * Goal contribution math. Code owns this entirely — the AI narrates the
 * numbers this module produces, it never invents monthlyContribution,
 * onTrack, or a date on its own (see api/plan/route.ts).
 *
 * All months are handled as YYYY-MM for the arithmetic (contributions are
 * a monthly concept); target dates carry a full YYYY-MM-DD for display and
 * for save-plan to persist, but only the month/year matter to this module.
 */

import { monthNameToNumber } from './dateHelpers';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Whole calendar months from `from` to `to` (both YYYY-MM or YYYY-MM-DD). Can be 0 or negative. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.slice(0, 7).split('-').map(Number);
  const [ty, tm] = to.slice(0, 7).split('-').map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

/** Adds `months` calendar months to a YYYY-MM (or YYYY-MM-DD) month, returning YYYY-MM. */
export function addMonthsToMonth(month: string, months: number): string {
  const [y, m] = month.slice(0, 7).split('-').map(Number);
  const idx = (m - 1) + months;
  const targetYear = y + Math.floor(idx / 12);
  const targetMonth = ((idx % 12) + 12) % 12;
  return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}`;
}

/** Excel serial date (days since 1899-12-30) → YYYY-MM-DD. null if not a sane serial. */
export function excelSerialToISODate(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const epochUTC = Date.UTC(1899, 11, 30);
  const d = new Date(epochUTC + serial * 86400000);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "September 2026" / "Septembre 2026" → "2026-09-01". null if no recognizable month+year. */
export function parseMonthYearText(text: string): string | null {
  const month = monthNameToNumber(text);
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  if (month && yearMatch) {
    return `${yearMatch[0]}-${String(month).padStart(2, '0')}-01`;
  }
  return null;
}

export type GoalDateParseResult = { date: string | null; flagged: boolean };

/**
 * Parses a Goals-sheet target-date cell. A blank cell is a legitimate "no
 * date set yet" (date: null, flagged: false). A non-empty cell that can't
 * be understood — as an Excel date serial or as recognizable month+year
 * text — is flagged rather than silently treated as blank: those look
 * identical downstream otherwise, and a typo'd date should never quietly
 * disappear.
 */
export function parseGoalTargetDate(cell: unknown): GoalDateParseResult {
  if (cell == null) return { date: null, flagged: false };

  if (typeof cell === 'number') {
    const date = excelSerialToISODate(cell);
    return date ? { date, flagged: false } : { date: null, flagged: true };
  }

  if (typeof cell === 'string') {
    const trimmed = cell.trim();
    if (!trimmed) return { date: null, flagged: false };
    const parsed = parseMonthYearText(trimmed);
    return parsed ? { date: parsed, flagged: false } : { date: null, flagged: true };
  }

  return { date: null, flagged: true };
}

export type Contribution =
  | { status: 'funded' }
  | { status: 'past_due' }
  | { status: 'no_date' }
  | { status: 'ok'; monthlyRequired: number; monthsToTarget: number };

/**
 * (target − saved) ÷ months-to-target — the one place this math happens.
 * Edge cases are explicit outcomes, never silently clamped:
 *   - saved ≥ target        → 'funded' (already there, nothing to project)
 *   - no target date at all → 'no_date' (nothing to measure against)
 *   - target month ≤ today  → 'past_due' (no negative months, no ÷0)
 */
export function requiredMonthlyContribution(
  targetAmount: number,
  savedSoFar: number,
  targetDate: string | null,
  today: string
): Contribution {
  if (savedSoFar >= targetAmount) return { status: 'funded' };
  if (!targetDate) return { status: 'no_date' };
  const monthsToTarget = monthsBetween(today, targetDate);
  if (monthsToTarget <= 0) return { status: 'past_due' };
  return {
    status: 'ok',
    monthlyRequired: round2((targetAmount - savedSoFar) / monthsToTarget),
    monthsToTarget,
  };
}

/**
 * The month a goal would actually be reached at a given monthly capacity —
 * the honest alternative to a stated date the plan can't support. null
 * means never, at this capacity (capacity ≤ 0 and not already funded).
 */
export function achievableMonth(
  targetAmount: number,
  savedSoFar: number,
  monthlyCapacity: number,
  today: string
): string | null {
  const remaining = targetAmount - savedSoFar;
  if (remaining <= 0) return today.slice(0, 7);
  if (monthlyCapacity <= 0) return null;
  return addMonthsToMonth(today, Math.ceil(remaining / monthlyCapacity));
}

export type GoalResult = {
  name: string;
  targetAmount: number;
  savedSoFar: number;                // carried through unchanged — save-plan seeds this as an opening transaction
  hasTargetDate: boolean;
  targetDate: string | null;         // stated date (YYYY-MM-DD), as given — never rewritten
  monthlyContribution: number;       // required monthly for the STATED date; 0 when funded, past-due, or no date
  onTrack: boolean;
  fundedAlready: boolean;
  pastDue: boolean;
  estimatedDate: string | null;      // stated month if on track; the honest alternative otherwise; null if nothing to estimate
};

/**
 * Evaluates every goal against ONE shared monthly capacity figure — the
 * plan's net cash flow (income − expenses − 0 savings at plan creation),
 * exactly as already computed by templateParser.ts / buildCalculated (see
 * api/plan/route.ts, which passes it straight through). A goal only counts
 * as on-track if its own required contribution fits within capacity AFTER
 * every OTHER goal's required contribution is also accounted for — goals
 * share one pool of money, never evaluated as if each had the whole plan's
 * capacity to itself.
 */
export function evaluateGoals(
  goals: { name: string; targetAmount: number; savedSoFar: number; targetDate: string | null }[],
  monthlyCapacity: number,
  today: string
): GoalResult[] {
  const withContribution = goals.map((g) => ({
    ...g,
    contribution: requiredMonthlyContribution(g.targetAmount, g.savedSoFar, g.targetDate, today),
  }));

  const totalRequired = withContribution.reduce(
    (sum, g) => sum + (g.contribution.status === 'ok' ? g.contribution.monthlyRequired : 0),
    0
  );

  return withContribution.map((g) => {
    if (g.contribution.status === 'funded') {
      return {
        name: g.name, targetAmount: g.targetAmount, savedSoFar: g.savedSoFar,
        hasTargetDate: !!g.targetDate, targetDate: g.targetDate,
        monthlyContribution: 0, onTrack: true, fundedAlready: true, pastDue: false,
        estimatedDate: today.slice(0, 7),
      };
    }

    if (g.contribution.status === 'no_date') {
      return {
        name: g.name, targetAmount: g.targetAmount, savedSoFar: g.savedSoFar,
        hasTargetDate: false, targetDate: null,
        monthlyContribution: 0, onTrack: false, fundedAlready: false, pastDue: false,
        estimatedDate: null,
      };
    }

    const ownRequired = g.contribution.status === 'ok' ? g.contribution.monthlyRequired : 0;
    const remainingCapacity = monthlyCapacity - (totalRequired - ownRequired);

    if (g.contribution.status === 'past_due') {
      return {
        name: g.name, targetAmount: g.targetAmount, savedSoFar: g.savedSoFar,
        hasTargetDate: true, targetDate: g.targetDate,
        monthlyContribution: 0, onTrack: false, fundedAlready: false, pastDue: true,
        estimatedDate: achievableMonth(g.targetAmount, g.savedSoFar, remainingCapacity, today),
      };
    }

    const onTrack = ownRequired <= remainingCapacity;
    return {
      name: g.name, targetAmount: g.targetAmount, savedSoFar: g.savedSoFar,
      hasTargetDate: true, targetDate: g.targetDate,
      monthlyContribution: ownRequired, onTrack, fundedAlready: false, pastDue: false,
      estimatedDate: onTrack
        ? g.targetDate!.slice(0, 7)
        : achievableMonth(g.targetAmount, g.savedSoFar, remainingCapacity, today),
    };
  });
}
