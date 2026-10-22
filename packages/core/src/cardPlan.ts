// ---------------------------------------------------------------------------
// A card's monthly plan (goal + category budgets) — the parts the web editor
// and the mobile editor share. Moved here from src/lib/envelopeHelpers.ts
// (2026-10-22, mobile S5) so both read one rule; the web re-exports them.
// ---------------------------------------------------------------------------

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * What the plan editor starts from: the plan the decision view is showing —
 * its own or carried forward — and nothing else. A category that only has
 * spend (planned: false) is not part of the plan, so opening the editor and
 * pressing Save writes the shown plan back unchanged instead of adding $0
 * budgets for it.
 */
export function editorItemsFrom<T extends { categoryId: string; categoryName: string; monthlyAmount: number; planned?: boolean }>(
  envelopeItems: T[]
): { categoryId: string; categoryName: string; monthlyAmount: number }[] {
  return envelopeItems
    .filter((i) => i.planned !== false)
    .map((i) => ({ categoryId: i.categoryId, categoryName: i.categoryName, monthlyAmount: i.monthlyAmount }));
}

/** True when the sum of item amounts STRICTLY exceeds totalGoal (equal is fine). */
export function sumWarning(
  items: { monthlyAmount: number }[],
  totalGoal: number
): boolean {
  const sum = r2(items.reduce((s, i) => s + i.monthlyAmount, 0));
  return sum > totalGoal;
}
