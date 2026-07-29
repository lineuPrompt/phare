/**
 * planChainHelpers.ts — the chained monthly plan ("the Plan"): "if every
 * month goes as budgeted, where do I land" — 12 months compounding forward
 * from today's real balance. Deliberately different from the real ledger
 * walk (buildCashTimeline/buildMonthView), which answers "given everything
 * actually dated, where do I land." Both are valid; they diverge on purpose
 * — but only where the plan is genuinely estimating something, never because
 * a real dated fact got dropped. See INVARIANT below.
 *
 * TERMS PER MONTH
 * -----------------
 *   balance(M) = balance(M-1) + income(M) − datedExpenses(M) − cardCost(M)
 *                − variableEstimate(M)
 * balance(month 0) chains off `anchorBalance` (today's real chequing
 * balance — buildCashTimeline's own `todayBalance`, never recomputed here).
 *
 * DATED, NOT FIXED — computeDatedRangeTotals (BUG FIX, was computeFixedRangeTotals)
 * ------------------------------------------------------------------------------
 * Every existing actuals helper (categorySpendHelpers.computeSignedSpendRows,
 * dashboardHelpers.computeMonthTotals) is built to answer "actual spend so
 * far," and drops or never expects rows dated after today. This function is
 * the one place in the app that deliberately reads already-materialized
 * FUTURE-dated rows as the plan itself, not history to be capped.
 *
 * It WAS scoped to recurring_item_id != null rows only ("fixed" bills), on
 * the theory that a manually-entered future expense was covered by the
 * variable-spend estimate instead. That was wrong and caused a real,
 * measured bug: a manually-entered, already-dated chequing expense is a
 * FACT — the real ledger walk counts it (it's just a transaction row), so a
 * plan that skips it reads higher than the real close for no legitimate
 * reason. The fix: sum EVERY dated chequing income/expense row in the
 * range, recurring-linked or not. is_bridge is the only structural
 * exclusion left (a card's cost is its own explicit term below — see NO
 * DOUBLE-COUNTING). The function and its terms are named DATED, not FIXED,
 * so the next reader doesn't reintroduce the recurring-only filter.
 *
 * Applies identically to months 2–12: a row already dated for a future
 * month — however it got there — is a fact, not a guess.
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
 * payment dated on or before today. For the partial first month (today
 * onward), a card whose bridgePaymentDate for the relevant cycle already
 * fell on or before today is therefore ALREADY inside the anchor — adding a
 * fresh cost term for it here would double it. computeMonthCardCost's
 * `excludeAlreadyPosted` flag (month-1 only) marks that card's term
 * basis:'posted', amount 0, instead of silently omitting it — the card
 * still shows up in the per-card disclosure, just labeled as already
 * reflected in the starting balance rather than vanishing. From month 2
 * onward every card's payment date for that month is still in the future,
 * so this condition can never fire there.
 *
 * VARIABLE SPEND — an estimate, not a dated term (Option B, founder-approved)
 * -------------------------------------------------------------------------
 * Chequing-side, non-fixed, non-bridge, expense-only spend has nothing
 * dated to sum for a future month (unlike fixed bills, cash groceries next
 * month don't materialize as real rows). computeTrailingVariableAverage
 * uses the exact trailing-3-month, current-month-excluded window
 * coachingHelpers.computeTypicalSurplus already established.
 *
 * BUG FIX — an empty trailing month is not a $0 measurement
 * ------------------------------------------------------------
 * computeTrailingVariableAverage used to divide by the full requested
 * window size regardless of how many months actually had data, so a
 * household with 1 real month and 2 unpopulated ones got roughly a third of
 * its true typical spend — "real months, never averaged" violated by
 * silently treating "no data yet" as "measured zero." Fixed: the average is
 * taken only over months carrying `hasRealData: true` (any real transaction
 * that month — the same signal coachingHelpers.computeInsufficientHistory
 * already consumes, so both read one shared per-month fact rather than two
 * independent guesses). Zero qualifying months → the estimate is
 * UNAVAILABLE (`null`), never a fabricated 0. A household with genuinely
 * zero real chequing-side variable spend across populated months still
 * correctly averages to 0 — that's a real measurement, not dilution.
 *
 * NETTING — narrower than "always net," and only for month 1
 * ------------------------------------------------------------
 * A dated non-recurring expense and the variable-spend estimate can
 * legitimately overlap only when they cover the SAME days. That is true for
 * month 1's prorated remainder (the estimate is explicitly "typical spend
 * for the days left in this month," and a dated one-off on one of those
 * same days is drawn from the same pool) — so month 1 nets
 * max(0, proratedEstimate − alreadyDatedVariableSpendInThatWindow). It is
 * NOT true for months 2–12: a dated $500 installment payment next spring is
 * additional to that month's typical day-to-day spending, not a
 * substitute for it — a family that already knows about an installment
 * still buys groceries. Months 2–12 subtract both terms in full, unnetted.
 *
 * INVARIANT (pinned in planChainHelpers.test.ts)
 * ------------------------------------------------
 * For month 1 only (the current, partial month — months 2–12 have no
 * comparable real close to bound against, since most of what they'd sum
 * legitimately isn't dated yet): the plan must never exceed the real
 * ledger's close for that same month, and must equal it exactly whenever
 * cardCostTotal + the applied variableEstimate is 0. Every dollar between
 * today and month-end is either a dated fact (now counted identically by
 * both) or a forward assumption that only ever subtracts further
 * anticipated spending — never a reason for the plan to read healthier
 * than a ledger that already contains every transaction through month-end.
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

// ── Dated income/expense (real, no today-cutoff, no recurring-only filter) ─

export type ChequingChainTx = {
  account_id: string;
  date: string;
  type: string; // 'income' | 'expense' | 'transfer'
  amount: number;
  recurring_item_id?: string | null;
  is_bridge?: boolean | null;
};

/**
 * Every dated chequing income/expense row in the range — recurring-linked
 * or manually entered, all counted alike. is_bridge is the only structural
 * exclusion (a card's cost is its own term — computeMonthCardCost). See the
 * file header's DATED, NOT FIXED note for why this isn't scoped to
 * recurring_item_id rows.
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
    const amt = Number(t.amount);
    if (t.type === 'income') income += amt;
    else if (t.type === 'expense') expenses += amt;
  }
  return { income: r2(income), expenses: r2(expenses) };
}

// ── Variable spend: dated-in-range (for netting) and trailing estimate ─────

/**
 * Chequing expense rows in the range that are neither recurring-linked nor
 * a bridge — "day-to-day" spend by exclusion. Used two ways: summed per
 * historical month for the trailing average, and summed against the
 * current month's own remaining days for month 1's netting (see file
 * header's NETTING note).
 */
export function computeVariableRangeTotal(
  transactions: ChequingChainTx[],
  chequingId: string,
  range: { start: string; end: string }
): number {
  let total = 0;
  for (const t of transactions) {
    if (t.account_id !== chequingId) continue;
    if (t.is_bridge) continue;
    if (t.recurring_item_id != null) continue;
    if (t.type !== 'expense') continue;
    if (t.date < range.start || t.date > range.end) continue;
    total += Number(t.amount);
  }
  return r2(total);
}

export function computeTrailingVariableMonthlyTotal(
  transactions: ChequingChainTx[],
  chequingId: string,
  month: string // YYYY-MM
): number {
  return computeVariableRangeTotal(transactions, chequingId, { start: `${month}-01`, end: lastDayOfMonth(month) });
}

export type TrailingVariableMonth = {
  month: string;
  total: number; // computeTrailingVariableMonthlyTotal's result for this month
  // Any real transaction existing for this month at all (any type/account —
  // the same fact coachingHelpers.computeInsufficientHistory consumes).
  // false means "no data," never "zero spend" — see file header BUG FIX note.
  hasRealData: boolean;
};

/**
 * Average of ONLY the trailing months that actually have real data. null
 * when none do — "unavailable," never a fabricated 0. A month with real
 * data but genuinely $0 variable spend still counts (that's a real
 * measurement); a month with no transactions at all does not.
 */
export function computeTrailingVariableAverage(months: TrailingVariableMonth[]): number | null {
  const withData = months.filter((m) => m.hasRealData);
  if (withData.length === 0) return null;
  return r2(withData.reduce((sum, m) => sum + m.total, 0) / withData.length);
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
  datedExpenses: number; // was fixedExpenses — see file header DATED, NOT FIXED
  cardCost: CardCostTerm[];
  cardCostTotal: number;
  variableEstimate: number; // 0 when variableEstimateMonthly was null (unavailable)
  balance: number; // running plan balance at the end of this range
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
};

/**
 * Builds the 12-month (or fewer, if monthsAhead is smaller) chained plan.
 * Pure — every input is already fetched/aggregated by the caller. The
 * chain-recurrence invariant (balance(M) === balance(M-1) + income(M) −
 * datedExpenses(M) − cardCostTotal(M) − variableEstimate(M)) holds by
 * construction: each entry is computed directly from the previous one in a
 * single forward pass, never independently re-derived.
 */
export function buildPlanChain(params: {
  anchorBalance: number;
  today: string; // YYYY-MM-DD
  currentMonth: string; // YYYY-MM — today's month, the chain's first entry
  monthsAhead: number; // e.g. 12, matching the recurring-materialization horizon
  chequingId: string;
  datedTransactions: ChequingChainTx[]; // chequing income/expense rows across the whole window
  cards: { id: string; name: string; statement_close_day: number | null; payment_day: number | null }[];
  cardBudgetRows: { account_id: string; card_goal: number; month: string }[];
  cardTransactions: { account_id: string; date: string; type: string; amount: number }[];
  variableEstimateMonthly: number | null; // computeTrailingVariableAverage's result; null = unavailable
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
}): PlanChainMonth[] {
  const {
    anchorBalance, today, currentMonth, monthsAhead, chequingId,
    datedTransactions, cards, cardBudgetRows, cardTransactions,
    variableEstimateMonthly, unanchoredIncomeCount, unanchoredExpenseCount,
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

    let variableEstimate: number;
    if (isPartialMonth) {
      const daysRemaining = daysBetweenInclusive(rangeStart, rangeEnd);
      const daysInMonth = daysInCalendarMonth(month);
      const prorated = variableEstimateMonthly !== null
        ? r2(variableEstimateMonthly * daysRemaining / daysInMonth)
        : 0;
      // NETTING — month 1 only, see file header. A dated non-recurring
      // expense already inside this same partial window is drawn from the
      // same "typical day-to-day spend" pool the prorated estimate covers.
      const alreadyDatedVariable = computeVariableRangeTotal(datedTransactions, chequingId, { start: rangeStart, end: rangeEnd });
      variableEstimate = r2(Math.max(0, prorated - alreadyDatedVariable));
    } else {
      // Months 2–12: no netting. A dated future one-off is additional to
      // that month's typical spending, not a substitute for it.
      variableEstimate = variableEstimateMonthly ?? 0;
    }

    balance = r2(balance + dated.income - dated.expenses - cardCostResult.total - variableEstimate);

    months.push({
      month, rangeStart, rangeEnd, isPartialMonth,
      income: dated.income,
      datedExpenses: dated.expenses,
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
