/**
 * timelineHelpers.ts — Build 3: Cash Timeline
 *
 * Pure functions only. No DB access. The API layer fetches data and injects it;
 * these helpers compute everything deterministically.
 *
 * RUNNING BALANCE CONVENTION
 * --------------------------
 * income   → + (money into chequing)
 * expense  → − (money out of chequing)
 * transfer → − (chequing→goal outflow)
 *
 * TRANSFER DIRECTION NOTE
 * -----------------------
 * All transfers today are chequing→goal only. The create_transfer RPC and
 * POST /api/transfers are strictly one-directional: p_chequing_id is always
 * the debit side, p_goal_id always the credit side. No goal→chequing reversal
 * mechanism exists. If one is ever added, signAmount must derive direction from
 * transfer_peer_id + account lookup rather than tx.type alone, and a
 * corresponding test must be added.
 *
 * INTRA-DAY ORDER
 * ---------------
 * Within a day, income entries are listed before expenses/transfers. This is a
 * display convention only — the end-of-day balance is the sum of all entries
 * regardless of order. No mid-day balance is ever computed or shown.
 *
 * ANCHOR SEMANTICS
 * ----------------
 * An anchor resets the running balance at the START of its date, before that
 * day's transactions are applied. A corrective mid-window anchor is intentional
 * drift correction: the system trusts the anchor over the derived value from
 * that day forward. Multiple anchors are walked in ascending date order.
 */

import { formatLocalDate } from './dateHelpers';

// ── Anchor selection ──────────────────────────────────────────────────────────

/**
 * Selects the anchors that buildCashTimeline needs for a given window.
 *
 * Returns: the latest anchor at or before windowStart (which becomes the walk
 * start — transactions are fetched from its date onward), PLUS all anchors
 * strictly inside the window (corrective anchors), sorted ascending.
 *
 * An anchor exactly on windowStart counts as pre-window (date ≤ windowStart).
 *
 * Returns [] when no qualifying anchors exist → buildCashTimeline will return
 * { ok: false, reason: 'no_anchor' }.
 *
 * The caller should use result[0].date as the transaction fetch start date
 * (never anchors[0].date of the full history, which grows unboundedly).
 */
export function selectAnchorsForTimeline(
  allAnchors: TimelineAnchor[],
  windowStart: string,  // YYYY-MM-DD (first day of the displayed month)
  windowEnd: string,    // YYYY-MM-DD (last day of the navigable range)
): TimelineAnchor[] {
  const sorted = [...allAnchors].sort((a, b) => a.date.localeCompare(b.date));

  // Latest anchor at or before windowStart (the effective pre-window anchor)
  const preWindow = [...sorted].reverse().find((a) => a.date <= windowStart);

  // All anchors strictly inside the window (corrective anchors)
  const inWindow = sorted.filter((a) => a.date > windowStart && a.date <= windowEnd);

  return [...(preWindow ? [preWindow] : []), ...inWindow];
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TimelineAnchor = {
  date: string;    // YYYY-MM-DD — balance resets to this value at start of day
  balance: number; // CAD dollars, 2 decimal places
};

export type TimelineTx = {
  id: string;
  date: string;                // YYYY-MM-DD
  description: string | null;
  amount: number;              // always positive in DB; sign derived from type
  type: 'income' | 'expense' | 'transfer';
  recurringItemId: string | null;
  recurrenceId: string | null;
  installmentLabel: string | null; // "N/Total" e.g. "3/12"
  transferPeerId: string | null;
  isBridge: boolean;
  bridgeSourceAccount: string | null;
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

export type TimelineResult =
  | {
      ok: true;
      /**
       * First date for which balances are available. Equals windowStart when an
       * anchor predates or matches the window; equals the anchor date when the
       * first anchor falls mid-window (days before it are omitted rather than
       * refused — the user gets a working ledger immediately).
       */
      balancesStartDate: string;
      /** Balance at the start of balancesStartDate, before that day's transactions. */
      openingBalance: number;
      /** Balance at the end of windowEnd. */
      closingBalance: number;
      /**
       * Balance at the end of today, or null when today falls before
       * balancesStartDate (e.g. viewing a future month where the anchor is later,
       * or a past month where today has already passed the window end).
       */
      todayBalance: number | null;
      /** All days from balancesStartDate to windowEnd, including days with no entries. */
      days: TimelineDay[];
      /**
       * Minimum end-of-day balance between today (exclusive) and the next income
       * entry in the window (inclusive). Null when today is outside the rendered
       * window or no future income entry exists in the window.
       */
      dip: DipInfo | null;
      /** Date of the first income entry after today within the window, or null. */
      nextIncomeDate: string | null;
    }
  | { ok: false; reason: 'no_anchor' };

// ── Internal helpers ──────────────────────────────────────────────────────────

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function signAmount(tx: TimelineTx): number {
  if (tx.type === 'income') return tx.amount;
  // expense and transfer are both outflows from chequing.
  // See TRANSFER DIRECTION NOTE in file header.
  return -tx.amount;
}

function advanceDay(date: string): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + 1);
  return formatLocalDate(d);
}

// ── Core helper ───────────────────────────────────────────────────────────────

/**
 * Builds a day-grouped, running-balance ledger for a chequing account.
 *
 * anchors       All anchors for this account with anchor_date ≤ windowEnd,
 *               sorted ascending by date. Refuse with no_anchor when empty.
 *
 * transactions  All chequing transactions from anchors[0].date through
 *               windowEnd (inclusive). The caller must include pre-window
 *               transactions so opening balance is correctly derived when
 *               the first anchor predates windowStart.
 *
 * The function is pure — caller injects `today` for testability.
 */
export function buildCashTimeline(params: {
  anchors: TimelineAnchor[];
  transactions: TimelineTx[];
  windowStart: string;
  windowEnd: string;
  today: string;
}): TimelineResult {
  const { anchors, transactions, windowStart, windowEnd, today } = params;

  if (anchors.length === 0) return { ok: false, reason: 'no_anchor' };

  // Walk begins at the earliest anchor, which may precede the window.
  const walkStart = anchors[0].date;

  // Output begins at whichever is later: windowStart or the first anchor.
  // When the anchor is mid-window, days before it are omitted rather than
  // refused — the user gets a working ledger immediately.
  const balancesStartDate = walkStart < windowStart ? windowStart : walkStart;

  // Build anchor lookup: date → balance (UNIQUE constraint ensures at most one per date)
  const anchorByDate = new Map<string, number>(
    anchors.map((a) => [a.date, a.balance])
  );

  // Group transactions by date. Within each day, income before expenses/transfers
  // (display convention — see file header).
  const txsByDate = new Map<string, TimelineTx[]>();
  for (const tx of transactions) {
    const list = txsByDate.get(tx.date);
    if (list) {
      list.push(tx);
    } else {
      txsByDate.set(tx.date, [tx]);
    }
  }
  const rank = (type: string) => (type === 'income' ? 0 : 1);
  for (const dayTxs of txsByDate.values()) {
    dayTxs.sort((a, b) => rank(a.type) - rank(b.type));
  }

  const days: TimelineDay[] = [];
  let running: number | null = null;
  let openingBalance = 0;
  let todayBalance: number | null = null;
  let openingCaptured = false;

  let cursor = walkStart;
  while (cursor <= windowEnd) {
    // Apply anchor at start of day — resets running balance before any transactions.
    if (anchorByDate.has(cursor)) {
      running = anchorByDate.get(cursor)!;
    }

    // Capture opening balance: balance at start of balancesStartDate, before txns.
    if (!openingCaptured && cursor === balancesStartDate && running !== null) {
      openingBalance = running;
      openingCaptured = true;
    }

    // Apply each transaction, rounding after every step to prevent FP drift.
    const dayTxs = txsByDate.get(cursor) ?? [];
    if (running !== null) {
      for (const tx of dayTxs) {
        running = r2(running + signAmount(tx));
      }
    }

    // Capture today's end-of-day balance.
    if (cursor === today) {
      todayBalance = running;
    }

    // Record this day if it falls in the output window and balance is known.
    if (cursor >= balancesStartDate && running !== null) {
      const entries: TimelineEntry[] = dayTxs.map((tx) => ({
        ...tx,
        signedAmount: signAmount(tx),
        isFuture: tx.date > today,
      }));
      days.push({
        date: cursor,
        entries,
        endOfDayBalance: running,
        isNegative: running < 0,
      });
    }

    cursor = advanceDay(cursor);
  }

  // Invariant: running must be non-null here. anchors[] is non-empty (checked above)
  // and the loop visits walkStart (= anchors[0].date ≤ windowEnd), setting running at
  // that point. If this throws, a caller broke one of those preconditions.
  if (running === null) {
    throw new Error(
      `buildCashTimeline invariant violated: running balance is null after loop. ` +
      `walkStart=${walkStart} windowEnd=${windowEnd} — the loop should have visited the anchor date.`
    );
  }
  const closingBalance = running;

  // Dip: minimum end-of-day balance from today (exclusive) to the next income
  // entry in the window (inclusive). Only computed when today is in the window.
  let nextIncomeDate: string | null = null;
  let dip: DipInfo | null = null;

  const todayInWindow = today >= balancesStartDate && today <= windowEnd;
  if (todayInWindow) {
    for (const day of days) {
      if (day.date > today && day.entries.some((e) => e.type === 'income')) {
        nextIncomeDate = day.date;
        break;
      }
    }

    if (nextIncomeDate !== null) {
      let minBalance = Infinity;
      let minDate = nextIncomeDate;
      for (const day of days) {
        if (day.date > today && day.date <= nextIncomeDate) {
          if (day.endOfDayBalance < minBalance) {
            minBalance = day.endOfDayBalance;
            minDate = day.date;
          }
        }
      }
      if (minBalance !== Infinity) {
        dip = { date: minDate, balance: minBalance };
      }
    }
  }

  return {
    ok: true,
    balancesStartDate,
    openingBalance,
    closingBalance,
    todayBalance,
    days,
    dip,
    nextIncomeDate,
  };
}
