/**
 * planChainHelpers.ts — the chained monthly plan ("the Plan"): "if every
 * month goes as budgeted, where do I land" — 12 months compounding forward
 * from today's real balance.
 *
 * THE MODEL — exactly two inputs, nothing else
 * -----------------------------------------------
 *   1. Every dated Timeline entry counts as-is: income, fixed bills, manual
 *      one-offs, transfers (contributions and draws) — at their real signed
 *      values. If it's dated, it's counted. If it isn't dated, it isn't
 *      spent (a future month with few dated entries reads high — that's
 *      correct and intended: unspent money is unspent until something is
 *      dated).
 *   2. The ONLY substitution: when the statement cycle paying in a given
 *      month has NOT closed, its real payment is unknowable, so the card's
 *      BUDGET stands in for it (computeMonthCardCost, reusing
 *      computeCardEnvelopeRemainders unchanged). Once the cycle has closed,
 *      the actual is known and used — nothing is substituted.
 * That's the whole model. There used to be a third input (a trailing
 * variable-spend estimate) — removed. It was never part of the requirement
 * and it duplicated what dated entries already do honestly.
 *
 * TERMS PER MONTH
 * -----------------
 *   balance(M) = balance(M-1) + income(M) − datedExpenses(M) − cardCost(M)
 * balance(month 0) chains off `anchorBalance` (today's real chequing
 * balance — buildCashTimeline's own `todayBalance`, never recomputed here).
 *
 * DATED, EVERY TYPE — computeDatedRangeTotals
 * -----------------------------------------------
 * Every dated chequing row in the range counts, recurring-linked or not,
 * income/expense/transfer alike — is_bridge is the only structural
 * exclusion (a card's cost is its own term, see NO DOUBLE-COUNTING below).
 *
 * BUG HISTORY, kept for the next reader:
 *   - It WAS scoped to recurring_item_id != null rows only ("fixed" bills).
 *     Fixed: a manually-entered future expense is a fact once dated.
 *   - It THEN classified only income/expense, silently dropping
 *     type='transfer' — a real $350 contribution was in the real ledger's
 *     close and invisible to the plan, reproducing the exact gap a second
 *     time under a different mechanism. Fixed by reusing
 *     timelineHelpers.signAmount — the SAME function the real ledger walk
 *     uses to decide inflow vs outflow — instead of a second, hand-rolled
 *     opinion about what a transfer means. A transfer's direction is NOT
 *     implied by its type: a debt draw is a transfer and an INFLOW (stored
 *     with a negative amount, see signAmount's own doc); hardcoding
 *     "transfer = outflow" would have understated any household with a
 *     draw — the mirror image of the bug it would have "fixed."
 * Both bugs are pinned below as a PROPERTY test asserting agreement with
 * buildCashTimeline (the real walk) over the same dated rows, rather than a
 * hardcoded expected number — the shape of test that would have caught
 * both on the first try.
 *
 * CARD COST REPLACES THE BRIDGE, IT DOESN'T SIT BESIDE IT
 * -----------------------------------------------------------
 * The real ledger's bridge rows only ever reflect actual-to-date spend
 * (bridgeHelpers.ts) — worthless as a forward planning figure for a cycle
 * that's mostly still ahead. This file's dated basis excludes is_bridge
 * entirely, and computeMonthCardCost adds its own explicit card-cost term
 * per month instead, reusing computeCardEnvelopeRemainders
 * (projectionHelpers.ts) UNCHANGED for the closed/open/max rule.
 *
 * THE MONTH-1 BOUNDARY — the one seam where a double-count can appear
 * ------------------------------------------------------------------------
 * `anchorBalance` (today's real balance) already includes any bridge
 * payment dated on or before today — that payment is a dated Timeline
 * entry like any other, already counted once, inside the anchor. For the
 * partial first month (today onward), a card whose bridgePaymentDate for
 * the relevant cycle already fell on or before today would otherwise get a
 * SECOND term here. computeMonthCardCost's `excludeAlreadyPosted` flag
 * (month-1 only) marks that card's term basis:'posted', amount 0, instead
 * of silently omitting it — the card still shows up in the per-card
 * disclosure, just labeled as already reflected in the starting balance.
 * From month 2 onward every card's payment date for that month is still in
 * the future, so this condition can never fire there.
 *
 * INVARIANTS (pinned in planChainHelpers.test.ts)
 * ---------------------------------------------------
 *   - PROPERTY: for any dated range with no open card cycles involved, the
 *     plan's totals agree EXACTLY with what buildCashTimeline (the real
 *     walk) produces over that same range — for every type, including a
 *     transfer-contribution and a transfer-draw.
 *   - CONSEQUENCE: for a month where every relevant statement cycle has
 *     already closed (nothing to substitute), the plan must equal the real
 *     ledger close exactly, to the cent — not approximately.
 *   - A dated credit-line draw in the remainder of the month must RAISE the
 *     plan, matching the real walk (it's a real inflow, not spend).
 */

import { addMonthsToMonth } from './goalHelpers';
import { bridgePaymentDate } from './dateHelpers';
import { computeCardEnvelopeRemainders } from './projectionHelpers';
import { signAmount } from './timelineHelpers';

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysInCalendarMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

function lastDayOfMonth(month: string): string {
  return `${month}-${String(daysInCalendarMonth(month)).padStart(2, '0')}`;
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

// ── Dated totals (real, no today-cutoff, every type) ────────────────────────

export type ChequingChainTx = {
  account_id: string;
  date: string;
  type: string; // 'income' | 'expense' | 'transfer'
  amount: number;
  recurring_item_id?: string | null;
  is_bridge?: boolean | null;
};

/**
 * Every dated chequing row in the range, signed via timelineHelpers'
 * signAmount — the same rule the real ledger walk uses, so this can never
 * develop a second opinion about what a transfer (contribution or draw)
 * does to the balance. is_bridge is the only structural exclusion.
 *
 * `income`/`expenses` are a SIGNED SPLIT for display, not a type
 * classification: a positive signAmount (real income, or a debt draw)
 * lands in `income`; a negative one (a real expense, or a savings
 * contribution) lands in `expenses`. `income − expenses` is exactly the
 * net delta a real balance walk would apply over the same range.
 */
export function computeDatedRangeTotals(
  transactions: ChequingChainTx[],
  chequingId: string,
  range: { start: string; end: string } // inclusive both ends; start > end = empty range = zeros
): { income: number; expenses: number } {
  let income = 0;
  let expenses = 0;
  for (const t of transactions) {
    if (t.account_id !== chequingId) continue;
    if (t.is_bridge) continue;
    if (t.date < range.start || t.date > range.end) continue;
    const signed = signAmount(t);
    if (signed >= 0) income += signed;
    else expenses += -signed;
  }
  return { income: r2(income), expenses: r2(expenses) };
}

// ── Per-month card cost (reuses computeCardEnvelopeRemainders unchanged) ───

export type CardCostBasis = 'actual' | 'budget' | 'max' | 'posted';

export type CardCostTerm = {
  cardId: string;
  cardName: string;
  basis: CardCostBasis;
  amount: number; // 0 when basis === 'posted' — already inside the anchor
  noData: boolean;
};

export function computeMonthCardCost(params: {
  cards: { id: string; name: string; statement_close_day: number | null; payment_day: number | null }[];
  cardBudgets: Map<string, number>;
  transactions: { account_id: string; date: string; type: string; amount: number }[];
  cycleMonth: string; // YYYY-MM
  today: string; // YYYY-MM-DD
  // True only for the chain's partial first month — see file header's
  // MONTH-1 BOUNDARY note. Every later month passes false.
  excludeAlreadyPosted: boolean;
}): { terms: CardCostTerm[]; total: number } {
  const { cards, cardBudgets, transactions, cycleMonth, today, excludeAlreadyPosted } = params;

  const remainders = computeCardEnvelopeRemainders({
    cards: cards.map((c) => ({ id: c.id, name: c.name, statement_close_day: c.statement_close_day })),
    cardBudgets,
    transactions,
    cycleMonth,
    today,
  });

  const cardById = new Map(cards.map((c) => [c.id, c]));

  const terms: CardCostTerm[] = remainders.map((r) => {
    const card = cardById.get(r.cardId)!;
    const alreadyPosted =
      excludeAlreadyPosted && bridgePaymentDate(cycleMonth, card.payment_day ?? 1) <= today;

    if (alreadyPosted) {
      return { cardId: r.cardId, cardName: r.cardName, basis: 'posted', amount: 0, noData: r.noData };
    }

    const actualOwed = Math.max(0, r.actual);
    const basis: CardCostBasis = r.closed
      ? 'actual'
      : r.budget === null
        ? 'actual'
        : actualOwed > r.budget
          ? 'max'
          : 'budget';

    return { cardId: r.cardId, cardName: r.cardName, basis, amount: r.payment, noData: r.noData };
  });

  return { terms, total: r2(terms.reduce((sum, t) => sum + t.amount, 0)) };
}

// ── Card budget carry-forward per cycle month ───────────────────────────────

/**
 * Same carry-forward rule the dashboard's single-month projection already
 * uses (route.ts: latest monthly_goals row at or before the cycle month) —
 * generalized here to resolve independently per cycle month across the
 * whole chain, since different months in the window can have different
 * "latest budget at or before" answers if the family changed an envelope
 * mid-year. Order-independent (picks the max eligible month per card), so
 * callers don't need to pre-sort `goalRows`.
 */
export function resolveCardBudgetsForCycle(
  goalRows: { account_id: string; card_goal: number; month: string }[],
  cycleMonth: string // YYYY-MM
): Map<string, number> {
  const cycleMonthDate = `${cycleMonth}-01`;
  const latestByCard = new Map<string, { month: string; card_goal: number }>();
  for (const row of goalRows) {
    if (row.month > cycleMonthDate) continue;
    const existing = latestByCard.get(row.account_id);
    if (!existing || row.month > existing.month) {
      latestByCard.set(row.account_id, { month: row.month, card_goal: row.card_goal });
    }
  }
  const result = new Map<string, number>();
  for (const [id, v] of latestByCard) result.set(id, v.card_goal);
  return result;
}

// ── The chain ────────────────────────────────────────────────────────────────

export type PlanChainMonth = {
  month: string; // YYYY-MM
  rangeStart: string; // YYYY-MM-DD, inclusive
  rangeEnd: string; // YYYY-MM-DD, inclusive
  isPartialMonth: boolean; // true only for the chain's first entry
  income: number;
  datedExpenses: number;
  cardCost: CardCostTerm[];
  cardCostTotal: number;
  balance: number; // running plan balance at the end of this range
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
};

/**
 * Builds the 12-month (or fewer, if monthsAhead is smaller) chained plan.
 * Pure — every input is already fetched/aggregated by the caller. The
 * chain-recurrence invariant (balance(M) === balance(M-1) + income(M) −
 * datedExpenses(M) − cardCostTotal(M)) holds by construction: each entry is
 * computed directly from the previous one in a single forward pass, never
 * independently re-derived.
 */
export function buildPlanChain(params: {
  anchorBalance: number;
  today: string; // YYYY-MM-DD
  currentMonth: string; // YYYY-MM — today's month, the chain's first entry
  monthsAhead: number; // e.g. 12, matching the recurring-materialization horizon
  chequingId: string;
  datedTransactions: ChequingChainTx[]; // chequing rows across the whole window, every type
  cards: { id: string; name: string; statement_close_day: number | null; payment_day: number | null }[];
  cardBudgetRows: { account_id: string; card_goal: number; month: string }[];
  cardTransactions: { account_id: string; date: string; type: string; amount: number }[];
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
}): PlanChainMonth[] {
  const {
    anchorBalance, today, currentMonth, monthsAhead, chequingId,
    datedTransactions, cards, cardBudgetRows, cardTransactions,
    unanchoredIncomeCount, unanchoredExpenseCount,
  } = params;

  const months: PlanChainMonth[] = [];
  let balance = anchorBalance;

  for (let i = 0; i < monthsAhead; i++) {
    const month = addMonthsToMonth(currentMonth, i);
    const isPartialMonth = i === 0;
    const rangeStart = isPartialMonth ? nextDay(today) : `${month}-01`;
    const rangeEnd = lastDayOfMonth(month);

    const dated = computeDatedRangeTotals(datedTransactions, chequingId, { start: rangeStart, end: rangeEnd });

    const cycleMonth = addMonthsToMonth(month, -1);
    const cardBudgets = resolveCardBudgetsForCycle(cardBudgetRows, cycleMonth);
    const cardCostResult = computeMonthCardCost({
      cards, cardBudgets, transactions: cardTransactions, cycleMonth, today,
      excludeAlreadyPosted: isPartialMonth,
    });

    balance = r2(balance + dated.income - dated.expenses - cardCostResult.total);

    months.push({
      month, rangeStart, rangeEnd, isPartialMonth,
      income: dated.income,
      datedExpenses: dated.expenses,
      cardCost: cardCostResult.terms,
      cardCostTotal: cardCostResult.total,
      balance,
      unanchoredIncomeCount,
      unanchoredExpenseCount,
    });
  }

  return months;
}
