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

export type EnvelopeStatus = 'ok' | 'over' | 'unset';

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Single-month per-category actuals
// ---------------------------------------------------------------------------

// Returns Map<category_id, totalAmount> for categorized expense transactions
// on cardId in month (YYYY-MM). Bridge lines and null category_id excluded.
export function categoryActualsForCard(
  transactions: EnvTx[],
  cardId: string,
  month: string
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of transactions) {
    if (t.account_id !== cardId) continue;
    if (t.type !== 'expense') continue;
    if (t.is_bridge) continue;
    if (!t.date.startsWith(month)) continue;
    if (!t.category_id) continue;
    map.set(t.category_id, r2((map.get(t.category_id) ?? 0) + Number(t.amount)));
  }
  return map;
}

// Sum of expense transactions on cardId in month with null category_id.
export function uncategorizedSpend(
  transactions: EnvTx[],
  cardId: string,
  month: string
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.account_id !== cardId) continue;
    if (t.type !== 'expense') continue;
    if (t.is_bridge) continue;
    if (!t.date.startsWith(month)) continue;
    if (t.category_id) continue;
    total += Number(t.amount);
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

// 'unset' when subBudget === 0; 'over' when actual > subBudget; else 'ok'.
export function envelopeStatus(subBudget: number, actual: number): EnvelopeStatus {
  if (subBudget <= 0) return 'unset';
  return actual > subBudget ? 'over' : 'ok';
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
// 12-month grid
// ---------------------------------------------------------------------------

export type GridRow = { categoryId: string; name: string; actuals: number[] };
export type GridData = {
  months: string[];
  rows: GridRow[];
  totalActuals: number[];
  totalGoals: (number | null)[];
};

// Build the read-only 12-month grid for one card.
// envelopeCategories defines the rows (the card's envelope categories).
// totalGoals: Map<'YYYY-MM', number | null>
// Grid cells are derived entirely from transactions — same source as single-month view.
export function buildGrid(
  transactions: EnvTx[],
  cardId: string,
  envelopeCategories: { id: string; name: string }[],
  months: string[],
  totalGoals: Map<string, number | null>
): GridData {
  const rows: GridRow[] = envelopeCategories.map((cat) => ({
    categoryId: cat.id,
    name: cat.name,
    actuals: months.map((month) => {
      return categoryActualsForCard(transactions, cardId, month).get(cat.id) ?? 0;
    }),
  }));

  const totalActuals = months.map((month) =>
    totalSpendForCard(transactions, cardId, month)
  );

  const totalGoalsList = months.map((month) => totalGoals.get(month) ?? null);

  return { months, rows, totalActuals, totalGoals: totalGoalsList };
}
