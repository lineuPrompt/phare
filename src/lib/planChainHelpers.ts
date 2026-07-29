/**
 * planChainHelpers.ts — the chained monthly plan ("the Plan"): "if every
 * month goes as budgeted, where do I land" — 12 months compounding forward
 * from today's real balance. Deliberately different from the real ledger
 * walk (buildCashTimeline/buildMonthView), which answers "given everything
 * actually dated, where do I land." Both are valid; they diverge on purpose.
 *
 * TERMS PER MONTH
 * -----------------
 *   balance(M) = balance(M-1) + income(M) − fixedExpenses(M) − cardCost(M)
 *                − variableEstimate(M)
 * balance(month 0) chains off `anchorBalance` (today's real chequing
 * balance — buildCashTimeline's own `todayBalance`, never recomputed here).
 *
 * WHY NOT computeMonthTotals — no today-cutoff allowed here
 * ------------------------------------------------------------
 * Every existing actuals helper (categorySpendHelpers.computeSignedSpendRows,
 * dashboardHelpers.computeMonthTotals) is built to answer "actual spend so
 * far," and drops or never expects rows dated after today. Applied to a
 * future month that would return nothing — this file's fixed-income/expense
 * aggregator (computeFixedRangeTotals) is the one place in the app that
 * deliberately reads already-materialized FUTURE-dated rows as the plan
 * itself, not history to be capped.
 *
 * FIXED = recurring-engine rows only, CHEQUING only
 * ---------------------------------------------------
 * recurring_item_id != null is the same fixed/variable split
 * categorySpendHelpers.ts already proved correct against a real household.
 * Scoped to chequing specifically (not "any spending account") because a
 * recurring item CAN target a credit card (e.g. a subscription charged to a
 * card) — that spend is already inside computeCardEnvelopeRemainders' cycle
 * totals via netCycleSpend, which sums every transaction on the card
 * regardless of recurring_item_id. Counting it again here under "fixed
 * expenses" would double it.
 *
 * BRIDGE EXCLUSION IS STRUCTURAL, NOT INCIDENTAL
 * ------------------------------------------------
 * A bridge row never carries recurring_item_id, so the recurring_item_id
 * filter alone would already exclude it — but is_bridge is checked
 * explicitly anyway, the same defensive pattern categorySpendHelpers.ts and
 * envelopeHelpers.ts already use, so this file's bridge exclusion doesn't
 * quietly depend on a coincidence of two unrelated columns.
 *
 * CARD COST REPLACES THE BRIDGE, IT DOESN'T SIT BESIDE IT
 * -----------------------------------------------------------
 * The real ledger's bridge rows only ever reflect actual-to-date spend
 * (bridgeHelpers.ts) — worthless as a forward planning figure for a cycle
 * that's mostly still ahead. This file's basis is is_bridge-excluded
 * entirely (see above), and computeMonthCardCost adds its own explicit
 * card-cost term per month instead, reusing computeCardEnvelopeRemainders
 * (projectionHelpers.ts) UNCHANGED for the closed/open/max rule.
 *
 * THE MONTH-1 BOUNDARY — the one seam where a double-count can appear
 * ------------------------------------------------------------------------
 * `anchorBalance` (today's real balance) already includes any bridge
 * payment dated on or before today. For the partial first month (today
 * onward), a card whose bridgePaymentDate for the relevant cycle already
 * fell on or before today is therefore ALREADY inside the anchor — adding a
 * fresh cost term for it here would double it. computeMonthCardCost's
 * `excludeAlreadyPosted` flag (month-1 only) marks that card's term
 * basis:'posted', amount 0, instead of silently omitting it — the card
 * still shows up in the per-card disclosure, just labeled as already
 * reflected in the starting balance rather than vanishing. From month 2
 * onward every card's payment date for that month is still in the future,
 * so this condition can never fire there — it isn't a special case that
 * persists, it's a boundary condition that only binds at the seam.
 *
 * VARIABLE SPEND — an estimate, not a dated term (Option B, founder-approved)
 * -------------------------------------------------------------------------
 * Chequing-side, non-fixed, non-bridge, expense-only spend has nothing
 * dated to sum for a future month (unlike fixed bills, cash groceries next
 * month don't materialize as real rows). computeTrailingVariableAverage
 * uses the exact trailing-3-month, current-month-excluded window
 * coachingHelpers.computeTypicalSurplus already established and the founder
 * already trusts elsewhere in the app. Thin-history disclosure reuses
 * coachingHelpers.computeInsufficientHistory directly (the caller builds
 * the MonthHistoryAvailability[] and calls it) rather than a new signal.
 * Cleanly separable from card cost by construction: card-account
 * transactions are never read by this aggregator at all, so there is no
 * data-model overlap to bound (unlike a `budgets` row, which covers a
 * category's spend on ANY account and would double the card-cost term for
 * a mostly-card-spent category).
 * A household with zero real chequing-side variable spend gets monthlyTotals
 * of all zeros, so the average — and therefore every month's
 * variableEstimate term — is exactly 0. No false deduction is invented.
 * For the partial first month, the flat monthly average is prorated by the
 * fraction of the month still ahead (days remaining ÷ days in month) — the
 * same "don't assume a full month's worth of spend lands in a partial
 * window" treatment the fixed-income/expense side gets for free from its
 * date range, applied explicitly here since there's no dated row to do it
 * automatically.
 */

import { addMonthsToMonth } from './goalHelpers';
import { bridgePaymentDate } from './dateHelpers';
import { computeCardEnvelopeRemainders } from './projectionHelpers';

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

function daysBetweenInclusive(start: string, end: string): number {
  if (start > end) return 0;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = end.split('-').map(Number);
  const s = Date.UTC(sy, sm - 1, sd);
  const e = Date.UTC(ey, em - 1, ed);
  return Math.round((e - s) / 86400000) + 1;
}

// ── Fixed income/expense (dated, real, no today-cutoff) ────────────────────

export type ChequingChainTx = {
  account_id: string;
  date: string;
  type: string; // 'income' | 'expense' | 'transfer'
  amount: number;
  recurring_item_id?: string | null;
  is_bridge?: boolean | null;
};

export function computeFixedRangeTotals(
  transactions: ChequingChainTx[],
  chequingId: string,
  range: { start: string; end: string } // inclusive both ends; start > end = empty range = zeros
): { income: number; fixedExpenses: number } {
  let income = 0;
  let fixedExpenses = 0;
  for (const t of transactions) {
    if (t.account_id !== chequingId) continue;
    if (t.is_bridge) continue;
    if (t.recurring_item_id == null) continue;
    if (t.date < range.start || t.date > range.end) continue;
    const amt = Number(t.amount);
    if (t.type === 'income') income += amt;
    else if (t.type === 'expense') fixedExpenses += amt;
  }
  return { income: r2(income), fixedExpenses: r2(fixedExpenses) };
}

// ── Trailing variable-spend estimate (Option B) ─────────────────────────────

/**
 * One trailing month's real chequing variable spend: expense-type,
 * chequing-only, never fixed (recurring_item_id set) or a bridge row.
 */
export function computeTrailingVariableMonthlyTotal(
  transactions: ChequingChainTx[],
  chequingId: string,
  month: string // YYYY-MM
): number {
  const start = `${month}-01`;
  const end = lastDayOfMonth(month);
  let total = 0;
  for (const t of transactions) {
    if (t.account_id !== chequingId) continue;
    if (t.is_bridge) continue;
    if (t.recurring_item_id != null) continue;
    if (t.type !== 'expense') continue;
    if (t.date < start || t.date > end) continue;
    total += Number(t.amount);
  }
  return r2(total);
}

/** Plain average of already-computed trailing monthly totals. 0 for an empty list. */
export function computeTrailingVariableAverage(monthlyTotals: number[]): number {
  if (monthlyTotals.length === 0) return 0;
  return r2(monthlyTotals.reduce((sum, v) => sum + v, 0) / monthlyTotals.length);
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
  fixedExpenses: number;
  cardCost: CardCostTerm[];
  cardCostTotal: number;
  variableEstimate: number;
  balance: number; // running plan balance at the end of this range
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
};

/**
 * Builds the 12-month (or fewer, if monthsAhead is smaller) chained plan.
 * Pure — every input is already fetched/aggregated by the caller. The
 * chain-recurrence invariant (balance(M) === balance(M-1) + income(M) −
 * fixedExpenses(M) − cardCostTotal(M) − variableEstimate(M)) holds by
 * construction: each entry is computed directly from the previous one in a
 * single forward pass, never independently re-derived.
 */
export function buildPlanChain(params: {
  anchorBalance: number;
  today: string; // YYYY-MM-DD
  currentMonth: string; // YYYY-MM — today's month, the chain's first entry
  monthsAhead: number; // e.g. 12, matching the recurring-materialization horizon
  chequingId: string;
  fixedTransactions: ChequingChainTx[]; // chequing income/expense rows across the whole window
  cards: { id: string; name: string; statement_close_day: number | null; payment_day: number | null }[];
  cardBudgetRows: { account_id: string; card_goal: number; month: string }[];
  cardTransactions: { account_id: string; date: string; type: string; amount: number }[];
  variableEstimateMonthly: number; // flat trailing-average figure (computeTrailingVariableAverage)
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
}): PlanChainMonth[] {
  const {
    anchorBalance, today, currentMonth, monthsAhead, chequingId,
    fixedTransactions, cards, cardBudgetRows, cardTransactions,
    variableEstimateMonthly, unanchoredIncomeCount, unanchoredExpenseCount,
  } = params;

  const months: PlanChainMonth[] = [];
  let balance = anchorBalance;

  for (let i = 0; i < monthsAhead; i++) {
    const month = addMonthsToMonth(currentMonth, i);
    const isPartialMonth = i === 0;
    const rangeStart = isPartialMonth ? nextDay(today) : `${month}-01`;
    const rangeEnd = lastDayOfMonth(month);

    const fixed = computeFixedRangeTotals(fixedTransactions, chequingId, { start: rangeStart, end: rangeEnd });

    const cycleMonth = addMonthsToMonth(month, -1);
    const cardBudgets = resolveCardBudgetsForCycle(cardBudgetRows, cycleMonth);
    const cardCostResult = computeMonthCardCost({
      cards, cardBudgets, transactions: cardTransactions, cycleMonth, today,
      excludeAlreadyPosted: isPartialMonth,
    });

    let variableEstimate: number;
    if (isPartialMonth) {
      const daysRemaining = daysBetweenInclusive(rangeStart, rangeEnd);
      const daysInMonth = daysInCalendarMonth(month);
      variableEstimate = r2(variableEstimateMonthly * daysRemaining / daysInMonth);
    } else {
      variableEstimate = variableEstimateMonthly;
    }

    balance = r2(balance + fixed.income - fixed.fixedExpenses - cardCostResult.total - variableEstimate);

    months.push({
      month, rangeStart, rangeEnd, isPartialMonth,
      income: fixed.income,
      fixedExpenses: fixed.fixedExpenses,
      cardCost: cardCostResult.terms,
      cardCostTotal: cardCostResult.total,
      variableEstimate,
      balance,
      unanchoredIncomeCount,
      unanchoredExpenseCount,
    });
  }

  return months;
}
