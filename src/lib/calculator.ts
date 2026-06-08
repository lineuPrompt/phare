/**
 * Phare Financial Calculator
 * ---------------------------
 * Deterministic financial math. NO AI. NO cost. Always correct.
 *
 * This module computes verified figures from parsed spreadsheet rows so that
 * the AI layer only ever INTERPRETS real numbers — it never invents them.
 *
 * Design rule: if a value cannot be confidently determined, it is reported as
 * `detected: false` rather than guessed. The AI prompt must respect this and
 * say "not provided" instead of fabricating a figure.
 *
 * Currently handles the "label/amount pairs" structure (one row = one line
 * item, e.g. ["Mortgage", 2567.94]). This is the structure the Phare template
 * produces and that many simple budget sheets use. Chaotic multi-column
 * layouts (daily planners, side-by-side months) are NOT parsed here — those
 * fall back to the AI path or the template.
 */

// A single row reduced to a label and a numeric amount.
export interface LabelAmountRow {
  label: string;
  amount: number;
}

export interface CategorizedLine {
  label: string;
  amount: number;
}

export interface CalculationResult {
  income: {
    detected: boolean;
    lines: CategorizedLine[];
    total: number;
  };
  expenses: {
    detected: boolean;
    lines: CategorizedLine[];
    total: number;
  };
  netCashFlow: number;
  // Lines we deliberately excluded (totals, profit, budget %) — kept for transparency.
  excludedLines: CategorizedLine[];
  // Confidence flag the AI layer and UI can use.
  confidence: "high" | "low";
}

// Money actually coming IN: salaries and government benefits.
const INCOME_KEYWORDS = [
  "salario", "salaire", "salary", "wage",
  "benefit", "assistance", "allocation", "ccb", "child benefit",
  "income", "revenu", "revenue",
];

// Derived or summary lines that must NEVER be counted as income or expense:
// profit/net lines, totals, and budget-percentage breakdowns.
const EXCLUDE_KEYWORDS = [
  "lucro", "profit", "net",
  "total", "cartoes + fixos", "subtotal",
  "%", "percentage", "percent",
  "housing 3", "food 2", "transport 1",
  "utilities 5", "debt 1", "savings 1", "outros",
  "budget percentage",
];

function matches(label: string, keywords: string[]): boolean {
  const low = label.toLowerCase();
  return keywords.some((k) => low.includes(k));
}

/**
 * Compute verified income, expenses, and net cash flow from label/amount rows.
 */
export function calculateFinancials(rows: LabelAmountRow[]): CalculationResult {
  const income: CategorizedLine[] = [];
  const expenses: CategorizedLine[] = [];
  const excluded: CategorizedLine[] = [];

  for (const { label, amount } of rows) {
    const trimmed = label.trim();
    if (!trimmed || !Number.isFinite(amount)) continue;

    if (matches(trimmed, EXCLUDE_KEYWORDS)) {
      excluded.push({ label: trimmed, amount });
    } else if (matches(trimmed, INCOME_KEYWORDS)) {
      income.push({ label: trimmed, amount });
    } else if (amount > 0) {
      expenses.push({ label: trimmed, amount });
    }
    // amount <= 0 and not income/excluded → ignored (likely budget targets/credits)
  }

  const incomeTotal = round(income.reduce((s, l) => s + l.amount, 0));
  const expenseTotal = round(expenses.reduce((s, l) => s + l.amount, 0));

  return {
    income: {
      detected: income.length > 0,
      lines: income,
      total: incomeTotal,
    },
    expenses: {
      detected: expenses.length > 0,
      lines: expenses,
      total: expenseTotal,
    },
    netCashFlow: round(incomeTotal - expenseTotal),
    excludedLines: excluded,
    // High confidence only when we found BOTH income and a reasonable number of expenses.
    confidence: income.length > 0 && expenses.length >= 3 ? "high" : "low",
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Reduce arbitrary sheet rows (arrays of cells) to label/amount pairs.
 * Looks at the first text cell as the label and the first numeric cell as the amount.
 * Returns only rows where both are present.
 */
export function extractLabelAmountPairs(
  rows: unknown[][]
): LabelAmountRow[] {
  const pairs: LabelAmountRow[] = [];

  for (const row of rows) {
    let label: string | null = null;
    let amount: number | null = null;

    for (const cell of row) {
      if (label === null && typeof cell === "string" && cell.trim()) {
        label = cell.trim();
      } else if (amount === null && typeof cell === "number" && Number.isFinite(cell)) {
        amount = cell;
      }
      if (label !== null && amount !== null) break;
    }

    if (label !== null && amount !== null) {
      pairs.push({ label, amount });
    }
  }

  return pairs;
}
