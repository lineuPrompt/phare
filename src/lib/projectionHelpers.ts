/**
 * projectionHelpers.ts — dashboard "Projected month-end" tile.
 *
 * Answers "if we stay within our card envelopes, where does this month
 * end?" — distinct from the surplus tile (this month's cash flow only) and
 * from the timeline's own closing balance (materialized entries only, no
 * assumption about unspent budget still to come).
 *
 * ONE SOURCE OF TRUTH
 * --------------------
 * The starting point is the timeline's own real balance walk for the viewed
 * month (buildCashTimeline / buildMonthView's closesAt) — never recomputed
 * here. This file only adds one thing on top: the portion of each card's
 * envelope budget that hasn't been spent (or recorded) yet, and therefore
 * isn't reflected in that closing balance at all.
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
 * NO DOUBLE-COUNTING
 * -------------------
 * The timeline's closing balance already includes that cycle's bridge
 * payment, sized to whatever spend is currently recorded (bridgeHelpers.ts's
 * "living rows"). Adding the card's FULL envelope budget on top would count
 * that recorded spend twice. Only the UNSPENT remainder — money that could
 * still be charged before the cycle closes but isn't in the ledger yet — is
 * subtracted here.
 *
 * ALREADY-CLOSED CYCLES
 * ----------------------
 * If the statement cycle's window has already ended as of today
 * (window.end < today), no further spend can ever land in it — the actual
 * figure recorded is final, not a snapshot of an in-progress cycle. Treating
 * "under budget" as still-spendable headroom there would be projecting money
 * that can no longer be spent. Remaining is forced to 0 for a closed cycle
 * regardless of budget vs. actual (this is on top of, not instead of, the
 * existing over-budget-→-0 rule).
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
  // month — never invent a budget for it; it contributes nothing.
  budget: number | null;
  // Net spend (expense minus refund) already recorded in the cycle window.
  actual: number;
  // max(0, budget − actual) — 0 when unbudgeted, over budget, or the cycle
  // has already closed (see "ALREADY-CLOSED CYCLES" above).
  remaining: number;
  unbudgeted: boolean;
  // True when window.end < today — the statement has already closed, so
  // `actual` is final, not a snapshot of an in-progress cycle.
  closed: boolean;
};

/**
 * cardBudgets: cardId → carried-forward envelope total (e.g. monthly_goals
 * .card_goal, latest row at or before cycleMonth). A card with NO entry in
 * this map (not one saved at $0) is treated as unbudgeted.
 *
 * today: YYYY-MM-DD, used only to detect an already-closed cycle (see
 * "ALREADY-CLOSED CYCLES" in the file header) — never to filter transactions.
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

    if (!cardBudgets.has(card.id)) {
      return { cardId: card.id, cardName: card.name, budget: null, actual, remaining: 0, unbudgeted: true, closed };
    }

    const budget = cardBudgets.get(card.id)!;
    return {
      cardId: card.id,
      cardName: card.name,
      budget,
      actual,
      remaining: closed ? 0 : Math.max(0, r2(budget - actual)),
      unbudgeted: false,
      closed,
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
  const totalRemaining = remainders.reduce((sum, r) => sum + r.remaining, 0);
  return r2(closingBalance - totalRemaining);
}
