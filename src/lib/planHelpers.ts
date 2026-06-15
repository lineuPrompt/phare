type BudgetCategory = { name: string; type: string; budgeted?: number };
type NamedFund = { name: string };

/**
 * A line cannot be both a monthly budget category AND a sinking fund.
 * Removes expense categories whose name matches a sinking fund.
 * Income categories are always kept.
 */
export function dedupeSinkingFunds<C extends BudgetCategory>(
  categories: C[],
  sinkingFunds: NamedFund[]
): C[] {
  const sinkingNames = new Set(
    sinkingFunds.map((f) => f.name.trim().toLowerCase())
  );
  return categories.filter(
    (cat) => cat.type === 'income' || !sinkingNames.has(cat.name.trim().toLowerCase())
  );
}