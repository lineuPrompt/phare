// Pure helpers for per-card budget envelope math.
// No Supabase / browser dependencies — safe to import in API routes and tests.

import { statementCycleWindow } from './dateHelpers';

export type EnvTx = {
  account_id: string;
  amount: number | string;
  category_id: string | null;
  type: string;
  date: string; // YYYY-MM-DD
  is_bridge?: boolean | null;
};

export type EnvelopeStatus = 'ok' | 'watch' | 'over' | 'unset';

// Display shape for one raw transaction line in a category's entry
// accordion (Cards page). Not aggregated — this is the per-entry view
// alongside the aggregated actual/remaining/status figures above.
export type CategoryEntryLine = {
  id: string;
  date: string;
  description: string | null;
  amount: number;
  type: 'expense' | 'income';
  installmentLabel: string | null;
};

export type CardTxRow = EnvTx & {
  id: string;
  description: string | null;
  installment_label: string | null;
};

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// expense adds to spend, income (a refund/credit on a card) nets against it.
// Any other transaction type (e.g. transfer) doesn't belong to card spend.
// Exported so bridgeHelpers.ts can net a card's cycle spend by the exact
// same rule — the bridge amount and the envelope actual must never disagree
// on what counts as a refund. Takes the minimal shape (not the full EnvTx)
// so callers don't need to fabricate unrelated fields just to call it.
export function signedAmount(t: { type: string; amount: number | string }): number | null {
  if (t.type === 'expense') return Number(t.amount);
  if (t.type === 'income') return -Number(t.amount);
  return null;
}

// ---------------------------------------------------------------------------
// Single-cycle per-category actuals
// ---------------------------------------------------------------------------

// Returns Map<category_id, netAmount> for categorized transactions on cardId
// within cycleMonth's statement cycle (statementCycleWindow(cycleMonth,
// closeDay) — see DISPLAY CONTRACT below): expenses minus refunds (income),
// net. Bridge lines and null category_id excluded. Net can go negative when
// refunds exceed spend — that's the honest number, not clamped to zero.
export function categoryActualsForCard(
  transactions: EnvTx[],
  cardId: string,
  cycleMonth: string,
  closeDay: number | null
): Map<string, number> {
  const window = statementCycleWindow(cycleMonth, closeDay);
  const map = new Map<string, number>();
  for (const t of transactions) {
    if (t.account_id !== cardId) continue;
    if (t.is_bridge) continue;
    if (t.date < window.start || t.date > window.end) continue;
    if (!t.category_id) continue;
    const signed = signedAmount(t);
    if (signed === null) continue;
    map.set(t.category_id, r2((map.get(t.category_id) ?? 0) + signed));
  }
  return map;
}

/**
 * DISPLAY CONTRACT (rewritten 2026-07-31 — supersedes the calendar-month
 * contract this docstring used to record; see the OLD CONTRACT note at the
 * end for what changed and why).
 *
 * Entries are grouped by STATEMENT CYCLE, not calendar month: a transaction
 * belongs to the cycle whose statementCycleWindow(cycleMonth, closeDay)
 * contains its date — the exact same window categoryActualsForCard uses
 * above, so the entry list a category's accordion shows can never drift from
 * the $ actual figure shown next to it. closeDay null falls back to the
 * plain calendar month (statementCycleWindow's own fallback), so a card with
 * no close day set behaves identically to the old calendar-month contract.
 *
 * WHY THIS CHANGED: the card page's job is answering "what will my statement
 * be" — a genuinely cycle-shaped question. Under the old calendar-month
 * contract, a charge dated after the close day counted against THIS month's
 * goal while actually being paid the FOLLOWING month's bridge — the goal
 * could read "Over" for a month whose real statement wasn't over at all, and
 * the number the family saw here structurally could not agree with the real
 * payment landing on Timeline. Cycle scoping makes those the same number by
 * construction: the tab labeled "July" is exactly the cycle bridgeHelpers.ts
 * calls spendMonth/cycleMonth "2026-07" — same window, same signedAmount
 * netting, same transactions — so a closed cycle's tab total and its
 * Timeline bridge payment amount are provably identical (see
 * bridgeHelpers.test.ts / envelopeHelpers.test.ts's cross-check).
 *
 * OLD CONTRACT (superseded, kept here for the record): entries used to be
 * grouped by the CALENDAR month of their date, with the statement cycle
 * governing ONLY which bridge payment date a card's spend rolled into, never
 * whether an entry was visible under a given month. That was a deliberate,
 * tested decision at the time (see project history, Build 4 Phase 1 round 2)
 * — this is not an accidental reversal of it, it's a considered replacement
 * once the calendar-month choice was found to make the card page's own goal
 * figure disagree with the real payment it was supposedly tracking.
 */
export function groupEntriesByCategory(
  transactions: CardTxRow[],
  cardId: string,
  cycleMonth: string,
  closeDay: number | null
): { byCategory: Record<string, CategoryEntryLine[]>; uncategorized: CategoryEntryLine[] } {
  const window = statementCycleWindow(cycleMonth, closeDay);
  const byCategory: Record<string, CategoryEntryLine[]> = {};
  const uncategorized: CategoryEntryLine[] = [];

  for (const t of transactions) {
    if (t.account_id !== cardId) continue;
    if (t.is_bridge) continue;
    if (t.date < window.start || t.date > window.end) continue;

    const line: CategoryEntryLine = {
      id: t.id,
      date: t.date,
      description: t.description,
      amount: Number(t.amount),
      type: t.type as 'expense' | 'income',
      installmentLabel: t.installment_label,
    };

    if (t.category_id) {
      (byCategory[t.category_id] ??= []).push(line);
    } else {
      uncategorized.push(line);
    }
  }

  return { byCategory, uncategorized };
}

// Net (expenses minus refunds) of transactions on cardId within cycleMonth's
// statement cycle, with null category_id.
export function uncategorizedSpend(
  transactions: EnvTx[],
  cardId: string,
  cycleMonth: string,
  closeDay: number | null
): number {
  const window = statementCycleWindow(cycleMonth, closeDay);
  let total = 0;
  for (const t of transactions) {
    if (t.account_id !== cardId) continue;
    if (t.is_bridge) continue;
    if (t.date < window.start || t.date > window.end) continue;
    if (t.category_id) continue;
    const signed = signedAmount(t);
    if (signed === null) continue;
    total += signed;
  }
  return r2(total);
}

// Total spend (categorized + uncategorized) for cardId within cycleMonth's
// statement cycle. This is the figure that must equal the bridge payment
// landing on Timeline for a CLOSED cycle (see the DISPLAY CONTRACT above and
// envelopeHelpers.test.ts's cross-check against bridgeHelpers.netCycleSpend).
export function totalSpendForCard(
  transactions: EnvTx[],
  cardId: string,
  cycleMonth: string,
  closeDay: number | null
): number {
  const categorized = Array.from(
    categoryActualsForCard(transactions, cardId, cycleMonth, closeDay).values()
  ).reduce((s, v) => s + v, 0);
  return r2(categorized + uncategorizedSpend(transactions, cardId, cycleMonth, closeDay));
}

// ---------------------------------------------------------------------------
// Envelope arithmetic
// ---------------------------------------------------------------------------

export function envelopeRemaining(subBudget: number, actual: number): number {
  return r2(subBudget - actual);
}

// 'unset' when subBudget <= 0; 'over' when actual > subBudget;
// 'watch' when actual is at or above 80% of subBudget; else 'ok'.
export function envelopeStatus(subBudget: number, actual: number): EnvelopeStatus {
  if (subBudget <= 0) return 'unset';
  if (actual > subBudget) return 'over';
  if (actual >= subBudget * 0.8) return 'watch';
  return 'ok';
}

// True when the sum of item amounts STRICTLY exceeds totalGoal (equal is fine).
export function sumWarning(
  items: { monthlyAmount: number }[],
  totalGoal: number
): boolean {
  const sum = r2(items.reduce((s, i) => s + i.monthlyAmount, 0));
  return sum > totalGoal;
}

// ---------------------------------------------------------------------------
// Carry-forward: a month-scoped snapshot (a goal, or an envelope item set)
// projects forward to any month with no explicit save of its own — the
// snapshot from the nearest saved month at-or-before the target wins.
// Read-only projection; never writes anything, so it never conflicts with
// "no silent auto-copy" for actual saves.
// ---------------------------------------------------------------------------

export function carryForwardMap<T>(
  snapshotsByMonth: Map<string, T>,
  month: string
): T | null {
  let best: string | null = null;
  for (const m of snapshotsByMonth.keys()) {
    if (m <= month && (best === null || m > best)) best = m;
  }
  return best !== null ? snapshotsByMonth.get(best)! : null;
}

// ---------------------------------------------------------------------------
// Forward-looking grid: current cycle + next 11. The current cycle shows
// real actuals (even $0 so far); future cycles are budget-only (actuals
// null) — the past doesn't help the decision, so this grid never looks
// backward. Budgets are carried forward per-cell from the nearest saved
// envelope snapshot at or before that month.
// ---------------------------------------------------------------------------

export type EnvelopeSnapshotItem = { categoryId: string; monthlyAmount: number };

export type GridRow = {
  categoryId: string;
  name: string;
  budgets: number[];          // one per month, carried forward
  actuals: (number | null)[]; // null = future cycle, budget-only
};
export type GridData = {
  months: string[];
  currentMonth: string;
  rows: GridRow[];
  uncategorizedActuals: (number | null)[];
  totalActuals: (number | null)[];
  totalGoals: (number | null)[];
};

// itemSnapshotsByMonth: Map<'YYYY-MM', items saved for exactly that month>
// categoryNames: Map<category_id, display name> for every household expense
// category — needed because a category can appear via actual activity
// (e.g. a refund) without ever having a saved envelope item.
// goalsByMonth: Map<'YYYY-MM', cardGoal saved for exactly that month>
// closeDay: the card's own statement_close_day — threaded to every cycle
// computation below; null produces exactly the old calendar-month behavior.
// today: a real YYYY-MM-DD (not just a calendar month) — needed because
// isFuture must compare against the currently open CYCLE's start date, not
// merely "is this calendar month in the future." Without today's exact day,
// a cycle spanning a calendar-month edge (e.g. a card closing on the 27th,
// viewed on the 28th) would have its already-open, already-accruing cycle
// wrongly classified as future/budget-only for the few days between the
// close day and the end of the calendar month — a live cycle with real money
// in it rendered as a placeholder. See envelopeHelpers.test.ts for the
// worked boundary case.
export function buildGrid(
  transactions: EnvTx[],
  cardId: string,
  itemSnapshotsByMonth: Map<string, EnvelopeSnapshotItem[]>,
  categoryNames: Map<string, string>,
  months: string[],
  goalsByMonth: Map<string, number>,
  currentMonth: string,
  closeDay: number | null,
  today: string
): GridData {
  const isFuture = (month: string) => statementCycleWindow(month, closeDay).start > today;

  const effectiveItems = months.map((month) => carryForwardMap(itemSnapshotsByMonth, month) ?? []);

  // Row set: any category ever in an effective snapshot, union any category
  // with actual activity in an eligible (non-future) cycle — a refund in a
  // budgetless category must still be visible, never a totals-only ghost.
  const rowIds = new Set<string>();
  effectiveItems.forEach((items) => items.forEach((i) => rowIds.add(i.categoryId)));
  months.forEach((month) => {
    if (isFuture(month)) return;
    for (const catId of categoryActualsForCard(transactions, cardId, month, closeDay).keys()) {
      rowIds.add(catId);
    }
  });

  const rows: GridRow[] = Array.from(rowIds).map((categoryId) => ({
    categoryId,
    name: categoryNames.get(categoryId) ?? '?',
    budgets: effectiveItems.map(
      (items) => items.find((i) => i.categoryId === categoryId)?.monthlyAmount ?? 0
    ),
    actuals: months.map((month) =>
      isFuture(month) ? null : (categoryActualsForCard(transactions, cardId, month, closeDay).get(categoryId) ?? 0)
    ),
  }));

  const uncategorizedActuals = months.map((month) =>
    isFuture(month) ? null : uncategorizedSpend(transactions, cardId, month, closeDay)
  );

  const totalActuals = months.map((month) =>
    isFuture(month) ? null : totalSpendForCard(transactions, cardId, month, closeDay)
  );

  const totalGoals = months.map((month) => carryForwardMap(goalsByMonth, month));

  return { months, currentMonth, rows, uncategorizedActuals, totalActuals, totalGoals };
}

// Sentinel categoryId for the always-net "no category" row shown alongside
// per-category rows on the Cards page (decision table, and its per-category
// entry accordion).
export const UNCATEGORIZED_ROW_ID = 'uncategorized';
