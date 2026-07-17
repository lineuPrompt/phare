// Pure helpers that feed the regenerate-plan review prose with code-computed
// facts the AI must narrate, never derive or contradict — Build 4 Part B
// review-hardening pass.

// A cadence's NORMAL occurrence count within one calendar month. monthly and
// semimonthly always land exactly at their typical count by construction
// (occurrencesInMonth never produces more), so they can never "windfall" —
// included here anyway for completeness, harmless since count will never
// exceed them. biweekly/weekly are the cadences that occasionally produce an
// extra occurrence in a given month (e.g. three biweekly paydays instead of
// the usual two).
const TYPICAL_OCCURRENCES: Record<string, number> = {
  monthly: 1,
  semimonthly: 2,
  biweekly: 2,
  weekly: 4,
};

export type WindfallFlag = {
  label: string;
  type: 'income' | 'expense';
  cadence: string;
  occurrences: number;
  typicalOccurrences: number;
  /** The amount of one occurrence — the "extra" one that won't repeat next month. */
  amount: number;
};

/**
 * Flags any recurring item whose occurrence count THIS reviewed month
 * exceeds its cadence's typical count — an extra paycheque, an extra
 * mortgage payment. Pure counting + comparison; the caller passes this
 * result into the AI context as a named fact the review must acknowledge
 * and must not present as a new run-rate.
 */
export function detectWindfalls(
  monthTransactions: { recurring_item_id: string | null; amount: number | string }[],
  recurringItems: { id: string; description: string; cadence: string; type: string }[]
): WindfallFlag[] {
  const itemsById = new Map(recurringItems.map((r) => [r.id, r]));
  const seen = new Map<string, { count: number; lastAmount: number }>();

  for (const tx of monthTransactions) {
    if (!tx.recurring_item_id) continue;
    const item = itemsById.get(tx.recurring_item_id);
    if (!item) continue;
    if (item.type !== 'income' && item.type !== 'expense') continue;

    const entry = seen.get(item.id) ?? { count: 0, lastAmount: 0 };
    entry.count += 1;
    entry.lastAmount = Number(tx.amount);
    seen.set(item.id, entry);
  }

  const flags: WindfallFlag[] = [];
  for (const [itemId, { count, lastAmount }] of seen) {
    const item = itemsById.get(itemId)!;
    const typical = TYPICAL_OCCURRENCES[item.cadence] ?? count;
    if (count > typical) {
      flags.push({
        label: item.description,
        type: item.type as 'income' | 'expense',
        cadence: item.cadence,
        occurrences: count,
        typicalOccurrences: typical,
        amount: lastAmount,
      });
    }
  }
  return flags;
}
