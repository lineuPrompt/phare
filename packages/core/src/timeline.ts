/**
 * timeline.ts — the Cash Timeline's shared display logic.
 *
 * Moved here from the web app's src/lib/timelineHelpers.ts and
 * src/lib/timelineDisplayHelpers.ts (2026-09-15) so the Expo app's Timeline
 * reads the SAME dip tiers and the SAME month slice as the web page. Those two
 * web files still re-export everything below from their original paths, so no
 * web import site changed.
 *
 * WHAT MOVED AND WHAT DID NOT. Only what a client renders: the result types,
 * classifyDip and its threshold, and buildMonthView. buildCashTimeline (the
 * walk itself), selectAnchorsForTimeline, signAmount, availableMonths and
 * groupUnbalancedTransactions stay in the web app — the server computes the
 * ledger, and no client recomputes it.
 *
 * WHY THE THRESHOLD IN PARTICULAR. A second copy of DIP_AMBER_THRESHOLD in the
 * mobile app is exactly the drift classifyDip was written to prevent: the same
 * dip reading amber on one surface and healthy on another. One definition, two
 * consumers.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimelineTx = {
  id: string;
  date: string;                // YYYY-MM-DD
  description: string | null;
  amount: number;              // positive in DB, EXCEPT a debt draw's chequing-
                               // side row (type='transfer'), which is stored
                               // negative — see the TRANSFER DIRECTION NOTE in
                               // the web app's src/lib/timelineHelpers.ts.
  type: 'income' | 'expense' | 'transfer';
  recurringItemId: string | null;
  recurrenceId: string | null;
  installmentLabel: string | null; // "N/Total" e.g. "3/12"
  transferPeerId: string | null;
  isBridge: boolean;
  bridgeSourceAccount: string | null;
  bridgeSourceMonth: string | null; // YYYY-MM — the card's spend month this bridge pays for
};

export type TimelineEntry = TimelineTx & {
  signedAmount: number; // positive = money in, negative = money out
  isFuture: boolean;    // date > today
};

export type TimelineDay = {
  date: string;
  // Income entries first, then expenses/transfers — display convention only.
  // End-of-day balance is the net of all entries regardless of this order.
  entries: TimelineEntry[];
  endOfDayBalance: number;
  isNegative: boolean;
};

export type DipInfo = {
  date: string;
  balance: number;
};

export type UnbalancedDay = {
  date: string;        // YYYY-MM-DD
  entries: TimelineTx[]; // income first, then expense/transfer — same convention as TimelineDay
};

// ---------------------------------------------------------------------------
// Dip classification — shared by the Timeline header, the dashboard's
// "lowest point" tile, DayLedger's month-low figure, AND the Expo app's
// Timeline. All of them render values buildCashTimeline computes; this is the
// one place the three-way healthy/amber/red read is decided, so no two
// surfaces can disagree about which color a given dip should be.
// ---------------------------------------------------------------------------

export type DipStatus = 'healthy' | 'amber' | 'red' | 'none';

// A positive dip below this dollar amount reads as "low" (amber) rather than
// "healthy" (green). Judgment call, not derived from any other figure in the
// app — there's no existing household-scale-relative signal available at
// this cutoff to derive it from instead. Tune here if it doesn't feel right
// in practice; every consumer of classifyDip picks it up automatically.
export const DIP_AMBER_THRESHOLD = 200;

export function classifyDip(dip: DipInfo | null): DipStatus {
  if (dip === null) return 'none';
  if (dip.balance < 0) return 'red';
  if (dip.balance < DIP_AMBER_THRESHOLD) return 'amber';
  return 'healthy';
}

// ── Single-month slice ───────────────────────────────────────────────────────

export type MonthView = {
  month: string;                    // YYYY-MM
  visibleDays: TimelineDay[];       // this month's days with >=1 entry, chronological
  unbalancedDays: UnbalancedDay[];  // this month's pre-balance days with entries, if any
  opensAt: number;                  // balance at the start of the month (or balancesStartDate if mid-month)
  closesAt: number;                 // balance at the end of the last known day in the month
  balancesBeginNote: boolean;       // true when balancesStartDate falls inside this month, after day 1
  /**
   * The lowest end-of-day balance anywhere in this month, and the first date
   * it is reached (2026-09-03).
   *
   * A DIFFERENT FIGURE FROM TimelineHeader's dip, deliberately. The dip is
   * today-anchored and stops at the next payday — it answers "will I run
   * short before I'm paid". This answers "how low does this month get",
   * which is a month-scoped question and therefore belongs in the month
   * strip, recomputed on every navigation. Neither is a restatement of the
   * other, and both are labelled so they cannot be read as the same number
   * disagreeing.
   *
   * Computed over EVERY day in the month, not just visibleDays: a day with
   * no entries carries the previous day's balance forward, so the minimum
   * can legitimately sit on an empty day (it is simply the first day that
   * reached it that gets named).
   */
  lowest: { date: string; balance: number };
};

/**
 * Slices a full fetched TimelineResult (days + unbalancedDays) down to one
 * calendar month for display. Returns null when the month has no data at
 * all in this result (outside [balancesStartDate, windowEnd]) — the caller
 * uses that to disable prev/next navigation rather than render an empty
 * month that looks like zero cash.
 */
export function buildMonthView(
  days: TimelineDay[],
  unbalancedDays: UnbalancedDay[],
  openingBalance: number,
  balancesStartDate: string,
  month: string
): MonthView | null {
  const monthDays = days.filter((d) => d.date.startsWith(month));
  if (monthDays.length === 0) return null;

  const firstIdx = days.indexOf(monthDays[0]);
  const opensAt = firstIdx > 0 ? days[firstIdx - 1].endOfDayBalance : openingBalance;
  const closesAt = monthDays[monthDays.length - 1].endOfDayBalance;
  const visibleDays = monthDays.filter((d) => d.entries.length > 0);
  const monthUnbalanced = unbalancedDays.filter((d) => d.date.startsWith(month));

  const balancesBeginNote =
    balancesStartDate.slice(0, 7) === month && balancesStartDate.slice(8, 10) !== '01';

  // Earliest date wins a tie — a flat run at the month's low is reported at
  // the day it first dropped there, which is the day that caused it.
  let lowest = { date: monthDays[0].date, balance: monthDays[0].endOfDayBalance };
  for (const d of monthDays) {
    if (d.endOfDayBalance < lowest.balance) {
      lowest = { date: d.date, balance: d.endOfDayBalance };
    }
  }

  return {
    month,
    visibleDays,
    unbalancedDays: monthUnbalanced,
    opensAt,
    closesAt,
    balancesBeginNote,
    lowest,
  };
}
