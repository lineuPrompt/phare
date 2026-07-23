/**
 * projectionHelpers.ts — dashboard "Projected balance at month end" tile.
 *
 * Answers "if we stay within our card envelopes, where does this month
 * end?" — distinct from the surplus tile (this month's cash flow only,
 * never carries a prior balance forward) and from the timeline's own
 * closing balance (materialized entries only, no assumption about unspent
 * budget still to come).
 *
 * ONE SOURCE OF TRUTH
 * --------------------
 * The starting point is the timeline's own real balance walk for the viewed
 * month (buildCashTimeline / buildMonthView's closesAt) — never recomputed
 * here. This file only adjusts one thing on top of it: for each card's
 * cycle landing in the viewed month, it replaces "whatever the real bridge
 * currently shows" with a PROJECTED payment per the rules below, and feeds
 * only the difference back as a deduction.
 *
 * CYCLE-TO-PAYMENT-MONTH MAPPING
 * -------------------------------
 * A card's statement cycle for month C produces a chequing payment in month
 * C+1, unconditionally (bridgePaymentDate, dateHelpers.ts / bridgeHelpers.ts)
 * — the configured payment day only changes the day-of-month the bridge
 * lands on (clamped to that month's length), never which month it falls in.
 * So for a viewed payment month M, the relevant cycle month is always M−1,
 * for every card, regardless of that card's own statement_close_day or
 * payment_day. Callers pass `cycleMonth = addMonthsToMonth(viewedMonth, -1)`.
 *
 * PER-CARD PROJECTED PAYMENT — real data where it exists, budget only where
 * it doesn't. A card is NEVER excluded from this computation; "no data" only
 * ever means it contributes $0, and that must be disclosed, not silent.
 *
 *   Cycle closed (window.end < today)   → actual spend, full stop. Nothing
 *                                          more can land in a closed cycle,
 *                                          so even an under-budget close is
 *                                          final, not a projection.
 *   Cycle still open, budget set        → max(actual so far, budget). Once
 *                                          the family has already exceeded
 *                                          the budget, the budget is
 *                                          counterfactual — actual wins.
 *                                          A cycle with zero transactions
 *                                          yet (entirely future) collapses
 *                                          into this same formula for free:
 *                                          max(0, budget) = budget.
 *   Cycle still open, no budget set     → actual spend so far (never $0
 *                                          just because there's no
 *                                          envelope — real recorded
 *                                          spending always counts).
 *
 * NO DOUBLE-COUNTING
 * -------------------
 * The timeline's closing balance already includes that cycle's real bridge
 * payment, which bridgeHelpers.ts sizes to max(0, actual) (a negative net —
 * refunds exceeding spend — produces no bridge row at all). So only the
 * DELTA between the projected payment and that already-reflected max(0,
 * actual) needs subtracting here — never the full projected payment on top
 * of a bridge that already reflects real spend.
 */

import { statementCycleWindow } from './dateHelpers';
import { netCycleSpend } from './bridgeHelpers';

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type CardCycleRemainder = {
  cardId: string;
  cardName: string;
  // null = no envelope ever saved for this card at or before the cycle
  // month. Never invented — a null budget only ever falls back to actual,
  // it's never treated as a $0 budget.
  budget: number | null;
  // Net spend (expense minus refund) recorded so far in the cycle window.
  // Can be negative (refunds exceeding spend) — never clamped here; only the
  // derived `payment`/`deduction` figures below are floored at 0.
  actual: number;
  // True when window.end < today — the statement has already closed, so
  // `actual` is final, not a snapshot of an in-progress cycle.
  closed: boolean;
  // The projected amount this card contributes to the payment landing in
  // the viewed month, per the rules in the file header. Always >= 0.
  payment: number;
  // payment − max(0, actual): the ADDITIONAL amount, beyond what the real
  // bridge already reflects, to subtract from the timeline's closing
  // balance. 0 whenever payment already equals (or is less than) what's
  // already recorded — never double-counts real spend.
  deduction: number;
  // True only when this card has NEITHER a budget NOR any real recorded
  // spend this cycle — genuinely nothing to project from. Must be disclosed
  // in the UI; a card is never silently dropped from the computation just
  // because it lacks an envelope.
  noData: boolean;
};

/**
 * cardBudgets: cardId → carried-forward envelope total (e.g. monthly_goals
 * .card_goal, latest row at or before cycleMonth). A card with NO entry in
 * this map (not one saved at $0) has budget: null.
 *
 * today: YYYY-MM-DD, used only to detect an already-closed cycle — never to
 * filter transactions.
 */
export function computeCardEnvelopeRemainders(params: {
  cards: { id: string; name: string; statement_close_day: number | null }[];
  cardBudgets: Map<string, number>;
  transactions: { account_id: string; date: string; type: string; amount: number }[];
  cycleMonth: string; // YYYY-MM
  today: string; // YYYY-MM-DD
}): CardCycleRemainder[] {
  const { cards, cardBudgets, transactions, cycleMonth, today } = params;

  return cards.map((card) => {
    const window = statementCycleWindow(cycleMonth, card.statement_close_day);
    const cardTxns = transactions.filter((t) => t.account_id === card.id);
    const actual = netCycleSpend(cardTxns, window);
    const closed = window.end < today;
    const budget = cardBudgets.has(card.id) ? cardBudgets.get(card.id)! : null;

    const actualOwed = Math.max(0, actual);
    const payment = closed
      ? actualOwed
      : budget === null
        ? actualOwed
        : Math.max(actualOwed, budget);

    return {
      cardId: card.id,
      cardName: card.name,
      budget,
      actual,
      closed,
      payment,
      deduction: r2(payment - actualOwed),
      noData: budget === null && actualOwed === 0,
    };
  });
}

/**
 * The widest statement-cycle window across a set of cards for one cycle
 * month — used to fetch every relevant transaction in a single query rather
 * than one round trip per card. Mirrors the per-card window union
 * ensureBridgesForWindow already computes internally (bridgeHelpers.ts).
 */
export function cycleFetchRange(
  cards: { statement_close_day: number | null }[],
  cycleMonth: string
): { start: string; end: string } | null {
  if (cards.length === 0) return null;
  let start: string | null = null;
  let end: string | null = null;
  for (const card of cards) {
    const w = statementCycleWindow(cycleMonth, card.statement_close_day);
    if (start === null || w.start < start) start = w.start;
    if (end === null || w.end > end) end = w.end;
  }
  return { start: start as string, end: end as string };
}

/**
 * closingBalance: the timeline's own closesAt for the viewed month
 * (buildMonthView, timelineDisplayHelpers.ts) — passed in, never recomputed.
 */
export function computeProjectedMonthEnd(closingBalance: number, remainders: CardCycleRemainder[]): number {
  const totalDeduction = remainders.reduce((sum, r) => sum + r.deduction, 0);
  return r2(closingBalance - totalDeduction);
}
