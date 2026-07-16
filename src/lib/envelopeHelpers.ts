// Pure helpers for per-card budget envelope math.
// No Supabase / browser dependencies — safe to import in API routes and tests.

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

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// expense adds to spend, income (a refund/credit on a card) nets against it.
// Any other transaction type (e.g. transfer) doesn't belong to card spend.
function signedAmount(t: EnvTx): number | null {
  if (t.type === 'expense') return Number(t.amount);
  if (t.type === 'income') return -Number(t.amount);
  return null;
}

// ---------------------------------------------------------------------------
// Single-month per-category actuals
// ---------------------------------------------------------------------------

// Returns Map<category_id, netAmount> for categorized transactions on cardId
// in month (YYYY-MM): expenses minus refunds (income), net. Bridge lines and
// null category_id excluded. Net can go negative when refunds exceed spend —
// that's the honest number, not clamped to zero.
export function categoryActualsForCard(
  transactions: EnvTx[],
  cardId: string,
  month: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of transactions) {
    if (t.account_id !== cardId) continue;
    if (t.is_bridge) continue;
    if (!t.date.startsWith(month)) continue;
    if (!t.category_id) continue;
    const signed = signedAmount(t);
    if (signed === null) continue;
    map.set(t.category_id, r2((map.get(t.category_id) ?? 0) + signed));
  }
  return map;
}

// Net (expenses minus refunds) of transactions on cardId in month with null category_id.
export function uncategorizedSpend(
  transactions: EnvTx[],
  cardId: string,
  month: string
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.account_id !== cardId) continue;
    if (t.is_bridge) continue;
    if (!t.date.startsWith(month)) continue;
    if (t.category_id) continue;
    const signed = signedAmount(t);
    if (signed === null) continue;
    total += signed;
  }
  return r2(total);
}

// Total spend (categorized + uncategorized) for cardId in month.
// Must equal the totalSpent shown on the Expenses page for the same card+month.
export function totalSpendForCard(
  transactions: EnvTx[],
  cardId: string,
  month: string
): number {
  const categorized = Array.from(
    categoryActualsForCard(transactions, cardId, month).values()
  ).reduce((s, v) => s + v, 0);
  return r2(categorized + uncategorizedSpend(transactions, cardId, month));
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
// Forward-looking grid: current month + next 11. The current month shows
// real actuals (even $0 so far); future months are budget-only (actuals
// null) — the past doesn't help the decision, so this grid never looks
// backward. Budgets are carried forward per-cell from the nearest saved
// envelope snapshot at or before that month.
// ---------------------------------------------------------------------------

export type EnvelopeSnapshotItem = { categoryId: string; monthlyAmount: number };

export type GridRow = {
  categoryId: string;
  name: string;
  budgets: number[];          // one per month, carried forward
  actuals: (number | null)[]; // null = future month, budget-only
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
export function buildGrid(
  transactions: EnvTx[],
  cardId: string,
  itemSnapshotsByMonth: Map<string, EnvelopeSnapshotItem[]>,
  categoryNames: Map<string, string>,
  months: string[],
  goalsByMonth: Map<string, number>,
  currentMonth: string
): GridData {
  const isFuture = (month: string) => month > currentMonth;

  const effectiveItems = months.map((month) => carryForwardMap(itemSnapshotsByMonth, month) ?? []);

  // Row set: any category ever in an effective snapshot, union any category
  // with actual activity in an eligible (non-future) month — a refund in a
  // budgetless category must still be visible, never a totals-only ghost.
  const rowIds = new Set<string>();
  effectiveItems.forEach((items) => items.forEach((i) => rowIds.add(i.categoryId)));
  months.forEach((month) => {
    if (isFuture(month)) return;
    for (const catId of categoryActualsForCard(transactions, cardId, month).keys()) {
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
      isFuture(month) ? null : (categoryActualsForCard(transactions, cardId, month).get(categoryId) ?? 0)
    ),
  }));

  const uncategorizedActuals = months.map((month) =>
    isFuture(month) ? null : uncategorizedSpend(transactions, cardId, month)
  );

  const totalActuals = months.map((month) =>
    isFuture(month) ? null : totalSpendForCard(transactions, cardId, month)
  );

  const totalGoals = months.map((month) => carryForwardMap(goalsByMonth, month));

  return { months, currentMonth, rows, uncategorizedActuals, totalActuals, totalGoals };
}

// Sentinel categoryId for the always-net "no category" row shown alongside
// per-category rows on the Cards page (decision table, and its per-category
// entry accordion).
export const UNCATEGORIZED_ROW_ID = 'uncategorized';
