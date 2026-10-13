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

// ---------------------------------------------------------------------------
// EXTRA INCOME AND EXTRA EXPENSES ARE DIFFERENT THINGS (2026-10-13).
//
// detectWindfalls flags any recurring item that landed more often than its
// cadence's usual count — income and expense alike — and the review used to
// pass both to the model in one list called "windfalls". Zezinho Test's
// October letter then called a third biweekly car payment a "$350 windfall"
// and recommended moving it to the emergency fund: an extra expense presented
// as money available. The list is now split, and only income is ever extra
// money.
// ---------------------------------------------------------------------------

export type ExtraOccurrence = {
  name: string;
  cadence: string;
  /** How many times it landed in the reviewed month (counted in code). */
  occurrences: number;
  /** How many times its cadence usually lands in a month. */
  usualOccurrences: number;
  /** One occurrence's amount: the part that will not repeat. */
  extraAmount: number;
};

function toExtra(f: WindfallFlag): ExtraOccurrence {
  return {
    name: f.label,
    cadence: f.cadence,
    occurrences: f.occurrences,
    usualOccurrences: f.typicalOccurrences,
    extraAmount: Number(f.amount),
  };
}

export function splitExtraOccurrences(flags: WindfallFlag[]): {
  extraIncome: ExtraOccurrence[];
  extraExpenses: ExtraOccurrence[];
} {
  return {
    extraIncome: flags.filter((f) => f.type === 'income').map(toExtra),
    extraExpenses: flags.filter((f) => f.type === 'expense').map(toExtra),
  };
}

/**
 * The one-time part of a month's net cash flow, signed: extra income raised
 * it, extra expenses lowered it. A typical month is netCashFlow MINUS this,
 * so extra income is taken back out and extra expenses are added back.
 *
 * Until 2026-10-13 every flag was summed as positive and subtracted, so an
 * extra expense was counted against the month twice.
 */
export function oneTimeNetEffect(flags: WindfallFlag[]): number {
  const cents = flags.reduce(
    (sum, f) => sum + (f.type === 'income' ? 1 : -1) * Math.round(Number(f.amount) * 100),
    0
  );
  return cents / 100;
}
