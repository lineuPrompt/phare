export type PlausibilityIssue =
  | { prong: 'income_vs_stated'; statedAnnual: number; computedAnnual: number }
  | { prong: 'deficit_not_financed'; monthlyDeficit: number };

export type PlausibilityResult =
  | { ok: true }
  | { ok: false; issues: PlausibilityIssue[] };

// Fire prong (a) if computed annual income < 60% of what the user said their combined income is.
const INCOME_VS_STATED_THRESHOLD = 0.6;

// Ignore sub-$100/month deficits (rounding, timing noise).
const MIN_DEFICIT_TO_FLAG = 100;

// Expense line labels that suggest the household is carrying financed debt.
// A deficit is suspicious only when NONE of these appear — if they do, the shortfall
// is being serviced by visible credit and we should not flag.
const DEBT_KEYWORDS = [
  'credit', 'line of credit', 'marge', 'marge de crédit',
  'loan', 'prêt', 'dette', 'debt',
  'mastercard', 'visa', 'amex', 'discover',
  'minimum payment', 'paiement minimum',
];

function hasDebtServicing(expenseLines: { label: string }[]): boolean {
  return expenseLines.some((l) =>
    DEBT_KEYWORDS.some((kw) => l.label.toLowerCase().includes(kw))
  );
}

/**
 * Prong (a): computed monthly income × 12 < 60% of the user's stated combined annual income.
 * Returns null when statedCombinedAnnual is null/zero (not provided → skip).
 */
export function checkIncomeVsStated(
  computedMonthlyIncome: number,
  statedCombinedAnnual: number | null,
): PlausibilityResult {
  if (!statedCombinedAnnual || statedCombinedAnnual <= 0) return { ok: true };

  const computedAnnual = computedMonthlyIncome * 12;
  if (computedAnnual < INCOME_VS_STATED_THRESHOLD * statedCombinedAnnual) {
    return {
      ok: false,
      issues: [{ prong: 'income_vs_stated', statedAnnual: statedCombinedAnnual, computedAnnual }],
    };
  }
  return { ok: true };
}

/**
 * Prong (b): the plan has a sustained deficit but no expense line finances it.
 * A real deficit must be paid for by something. If no credit/debt line appears,
 * the income is probably understated.
 */
export function checkDeficitNotFinanced(
  netCashFlow: number,
  expenseLines: { label: string }[],
): PlausibilityResult {
  if (netCashFlow >= -MIN_DEFICIT_TO_FLAG) return { ok: true };
  if (hasDebtServicing(expenseLines)) return { ok: true };

  return {
    ok: false,
    issues: [{ prong: 'deficit_not_financed', monthlyDeficit: Math.abs(netCashFlow) }],
  };
}

/**
 * Run both prongs and return the combined result.
 * If either fires, ok is false and issues lists every problem found.
 */
export function runPlausibilityGuard(opts: {
  computedMonthlyIncome: number;
  netCashFlow: number;
  expenseLines: { label: string }[];
  statedCombinedAnnual: number | null;
}): PlausibilityResult {
  const { computedMonthlyIncome, netCashFlow, expenseLines, statedCombinedAnnual } = opts;
  const issues: PlausibilityIssue[] = [];

  const prongA = checkIncomeVsStated(computedMonthlyIncome, statedCombinedAnnual);
  if (!prongA.ok) issues.push(...prongA.issues);

  const prongB = checkDeficitNotFinanced(netCashFlow, expenseLines);
  if (!prongB.ok) issues.push(...prongB.issues);

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true };
}
