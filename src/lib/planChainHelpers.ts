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
 *      month has NOT STARTED yet, there is nothing real to read, so the
 *      card's BUDGET stands in for it (computeMonthCardCost, reusing
 *      computeCardEnvelopeRemainders unchanged). A cycle in progress counts
 *      its actual so far (Lineu, 2026-11-13); a closed one its final actual.
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
import { bridgePaymentDate, statementCycleWindow } from '@phare/core';
import { computeCardEnvelopeRemainders } from './projectionHelpers';
import { signAmount } from './timelineHelpers';
import { computeMonthTotals, type AccountRow, type TxRow } from './dashboardHelpers';
import { detectWindfalls } from './reviewContextHelpers';
import { totalSpendForCard, cycleState, type EnvTx } from './envelopeHelpers';

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
  // Only the month BREAKDOWN reads these (computeMonthTotals' savings vs
  // debt-payment split resolves a transfer's destination through its peer).
  id?: string;
  transfer_peer_id?: string | null;
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
  // The budget this cycle resolved to (null = none ever saved). Passed through
  // from computeCardEnvelopeRemainders untouched — the statement check shows
  // it beside the card's real statements.
  budget: number | null;
  noData: boolean;
  // basis 'actual' on a statement still running: the amount is what's on it
  // so far — every dated entry in the window, since the plan counts whatever
  // is dated (a recurring bill later in the cycle included). A separate
  // flag, not a fifth basis, on purpose: installed mobile builds (1.0,
  // 1.1.0) refuse a basis they don't know (homeLoader BASES), and they label
  // 'actual' truthfully. Newer clients add "statement still open".
  inProgress: boolean;
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
      return { cardId: r.cardId, cardName: r.cardName, basis: 'posted', amount: 0, budget: r.budget, noData: r.noData, inProgress: false };
    }

    const actualOwed = Math.max(0, r.actual);
    const basis: CardCostBasis = r.closed || r.inProgress
      ? 'actual'
      : r.budget === null
        ? 'actual'
        : actualOwed > r.budget
          ? 'max'
          : 'budget';

    return { cardId: r.cardId, cardName: r.cardName, basis, amount: r.payment, budget: r.budget, noData: r.noData, inProgress: r.inProgress };
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

// ── The month's breakdown (2026-11-14) ───────────────────────────────────────
//
// A future month shows ONE sum that visibly adds up:
//   start + income + drawn − bills − savings − debt payments − cards = end
// The lines are computeMonthTotals' own buckets (the snapshot's classifier:
// savings vs debt payment by the transfer's destination, borrowed vs withdrawn
// by its source) over the SAME rows the chain counted for the month. They are
// never adjusted to fit: the month's lines must equal the chain's own change
// (income − datedExpenses) to the cent, or the breakdown is an ERROR and no
// line is shown at all. A half-right sum is worse than none.

export type PlanMonthLines = {
  income: number;
  bills: number; // chequing expenses; card payments (is_bridge) excluded
  savings: number;
  debtPayments: number;
  // Cash coming IN from a debt account or a savings account. One row on
  // screen ("From savings / borrowed"); summed here, in cents, never by a client.
  drawn: number;
  // income − bills − savings: only the "why" line's card-budget reason reads it.
  leftAfterBillsAndSavings: number;
  cards: number; // === the month's cardCostTotal
};

export type PlanMonthBreakdown =
  | { status: 'ok'; lines: PlanMonthLines }
  // linesNet / chainNet are for the server log only; the route strips them.
  | { status: 'error'; linesNet: number; chainNet: number };

// One extra occurrence of a recurring expense (a third biweekly mortgage
// payment), counted by reviewContextHelpers.detectWindfalls — the same rule
// the monthly review uses — with the planned dates attached.
export type PlanExtraPayment = {
  name: string;
  occurrences: number;
  usualOccurrences: number;
  dates: string[]; // YYYY-MM-DD, ascending
};

// Why a month dips. Code picks the reason; the clients only word it.
export type PlanMonthWhy =
  | { kind: 'extraPayments'; items: PlanExtraPayment[] }
  | { kind: 'cardsOverLeft'; cards: number; left: number }
  | { kind: 'startsBelowZero'; startBalance: number; isPartialMonth: boolean }
  | { kind: 'moreOutThanIn'; amount: number };

export type PlanChainMonth = {
  month: string; // YYYY-MM
  rangeStart: string; // YYYY-MM-DD, inclusive
  rangeEnd: string; // YYYY-MM-DD, inclusive
  isPartialMonth: boolean; // true only for the chain's first entry
  // The balance this range starts from: the previous month's `balance`, or
  // the anchor (today's real balance) for the first entry. The chain's own
  // running variable, recorded before it moves — never re-derived.
  startBalance: number;
  income: number;
  datedExpenses: number;
  cardCost: CardCostTerm[];
  cardCostTotal: number;
  balance: number; // running plan balance at the end of this range
  breakdown: PlanMonthBreakdown;
  extraPayments: PlanExtraPayment[];
  // Filled by explainPlanPath over the months a household can SEE (the
  // lowest month depends on the horizon). null until then, and for a month
  // that neither ends below zero nor is the path's lowest.
  why: PlanMonthWhy | null;
  unanchoredIncomeCount: number;
  unanchoredExpenseCount: number;
};

// What a client receives for one month: an error breakdown carries NO
// figures; the two nets go to the server log, never to a screen.
export type PlanChainMonthPayload = Omit<PlanChainMonth, 'breakdown'> & {
  breakdown: Extract<PlanMonthBreakdown, { status: 'ok' }> | { status: 'error' };
};

function cents(n: number): number {
  return Math.round(n * 100);
}

/**
 * The month's lines from computeMonthTotals over the same chequing rows the
 * chain counted (non-bridge, in range), checked against the chain's own net to
 * the cent. `peerRows` are the other side of each transfer — they sit on goal
 * accounts, so computeMonthTotals counts them in no bucket; it only reads their
 * account to classify.
 */
export function computeMonthBreakdown(params: {
  monthRows: ChequingChainTx[];
  peerRows: TxRow[];
  accounts: AccountRow[];
  chainIncome: number;
  chainExpenses: number;
  cardCostTotal: number;
}): PlanMonthBreakdown {
  const { monthRows, peerRows, accounts, chainIncome, chainExpenses, cardCostTotal } = params;
  const totals = computeMonthTotals(
    [
      ...monthRows.map((t) => ({
        id: t.id, account_id: t.account_id, type: t.type, amount: t.amount,
        transfer_peer_id: t.transfer_peer_id ?? null,
      })),
      ...peerRows,
    ],
    accounts
  );

  const drawnC = cents(totals.totalBorrowed) + cents(totals.totalWithdrawn);
  const linesNetC =
    cents(totals.totalIncome) + drawnC
    - cents(totals.totalExpenses) - cents(totals.totalSavings) - cents(totals.totalDebtPayments);
  const chainNetC = cents(chainIncome) - cents(chainExpenses);

  if (linesNetC !== chainNetC) {
    return { status: 'error', linesNet: linesNetC / 100, chainNet: chainNetC / 100 };
  }

  return {
    status: 'ok',
    lines: {
      income: totals.totalIncome,
      bills: totals.totalExpenses,
      savings: totals.totalSavings,
      debtPayments: totals.totalDebtPayments,
      drawn: drawnC / 100,
      leftAfterBillsAndSavings:
        (cents(totals.totalIncome) - cents(totals.totalExpenses) - cents(totals.totalSavings)) / 100,
      cards: cardCostTotal,
    },
  };
}

/**
 * Recurring expenses that land more often than their cadence's usual count in
 * this month's rows. Counting is detectWindfalls' — called per rule, so each
 * flag is tied to its rule id and its dates without changing what the
 * monthly review receives.
 */
export function findExtraPayments(
  monthRows: ChequingChainTx[],
  recurringItems: { id: string; description: string; cadence: string; type: string }[]
): PlanExtraPayment[] {
  const byRule = new Map<string, ChequingChainTx[]>();
  for (const t of monthRows) {
    if (!t.recurring_item_id) continue;
    const list = byRule.get(t.recurring_item_id) ?? [];
    list.push(t);
    byRule.set(t.recurring_item_id, list);
  }

  const out: PlanExtraPayment[] = [];
  for (const item of recurringItems) {
    const rows = byRule.get(item.id);
    if (!rows) continue;
    const [flag] = detectWindfalls(
      rows.map((r) => ({ recurring_item_id: r.recurring_item_id ?? null, amount: r.amount })),
      [item]
    );
    if (!flag || flag.type !== 'expense') continue;
    out.push({
      name: flag.label,
      occurrences: flag.occurrences,
      usualOccurrences: flag.typicalOccurrences,
      dates: rows.map((r) => r.date).sort(),
    });
  }
  return out;
}

/**
 * The "why" line, for the months a household can see. A month gets one when
 * it ends below zero or is the lowest month of the path (first one on a tie).
 * Reasons, first match wins:
 *   1. extra payments this month (a third mortgage payment) — at most 2 named;
 *   2. card cost (above zero) more than what's left after bills and savings;
 *   3. the month already starts below zero;
 *   4. more planned out than in (startBalance − balance).
 * Nothing true to say → null, never a filler sentence.
 */
export function explainPlanPath(months: PlanChainMonth[]): PlanChainMonth[] {
  if (months.length === 0) return months;
  let lowest = 0;
  for (let i = 1; i < months.length; i++) {
    if (months[i].balance < months[lowest].balance) lowest = i;
  }

  return months.map((m, i) => {
    if (!(m.balance < 0 || i === lowest)) return { ...m, why: null };

    let why: PlanMonthWhy | null = null;
    if (m.extraPayments.length > 0) {
      why = { kind: 'extraPayments', items: m.extraPayments.slice(0, 2) };
    } else if (
      m.breakdown.status === 'ok' &&
      // No card cost, no card reason: "$0 of cards is more than −$100" is
      // true and says nothing.
      cents(m.breakdown.lines.cards) > 0 &&
      cents(m.breakdown.lines.cards) > cents(m.breakdown.lines.leftAfterBillsAndSavings)
    ) {
      why = { kind: 'cardsOverLeft', cards: m.breakdown.lines.cards, left: m.breakdown.lines.leftAfterBillsAndSavings };
    } else if (m.startBalance < 0) {
      why = { kind: 'startsBelowZero', startBalance: m.startBalance, isPartialMonth: m.isPartialMonth };
    } else if (cents(m.startBalance) > cents(m.balance)) {
      why = { kind: 'moreOutThanIn', amount: (cents(m.startBalance) - cents(m.balance)) / 100 };
    }
    return { ...m, why };
  });
}

// ── Statement check ──────────────────────────────────────────────────────────
//
// Per card, its last closed statements (up to 4), totalled by the Cards page's
// own totalSpendForCard over its statement windows, with cycleState deciding
// "closed". Real statements, never an average: the low and the high, and how
// many statements they cover. A statement that ended before the card's first
// recorded transaction is not a $0 statement — it is no data — so it is
// skipped. A card with fewer than 2 is left out.

export type CardStatementHistory = {
  cardId: string;
  cardName: string;
  count: number;
  low: number;
  high: number;
  statements: { cycleMonth: string; total: number }[]; // newest first
};

export const STATEMENT_CHECK_MAX = 4;
// How far back to look for closed statements: the open cycle, up to 4 closed
// ones, and slack for statements skipped as before-first-transaction.
export const STATEMENT_CHECK_LOOKBACK_MONTHS = 7;

export function computeStatementHistory(params: {
  cards: { id: string; name: string; statement_close_day: number | null }[];
  cardTransactions: EnvTx[];
  firstTransactionDate: Map<string, string>; // cardId → earliest date ever
  currentMonth: string; // YYYY-MM
  today: string; // YYYY-MM-DD
}): CardStatementHistory[] {
  const { cards, cardTransactions, firstTransactionDate, currentMonth, today } = params;
  const out: CardStatementHistory[] = [];

  for (const card of cards) {
    const first = firstTransactionDate.get(card.id);
    if (!first) continue;
    const statements: { cycleMonth: string; total: number }[] = [];
    for (let back = 0; back <= STATEMENT_CHECK_LOOKBACK_MONTHS && statements.length < STATEMENT_CHECK_MAX; back++) {
      const cycleMonth = addMonthsToMonth(currentMonth, -back);
      if (cycleState(cycleMonth, card.statement_close_day, today) !== 'closed') continue;
      if (statementCycleWindow(cycleMonth, card.statement_close_day).end < first) break;
      statements.push({
        cycleMonth,
        total: totalSpendForCard(cardTransactions, card.id, cycleMonth, card.statement_close_day),
      });
    }
    if (statements.length < 2) continue;
    const totals = statements.map((s) => s.total);
    out.push({
      cardId: card.id,
      cardName: card.name,
      count: statements.length,
      low: Math.min(...totals),
      high: Math.max(...totals),
      statements,
    });
  }
  return out;
}

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
  // For the breakdown and the extra payments only — the balance never reads
  // them. Absent: every transfer classifies as savings (computeMonthTotals'
  // own fallback) and no extra payment is found.
  accounts?: AccountRow[];
  transferPeers?: TxRow[];
  recurringItems?: { id: string; description: string; cadence: string; type: string }[];
}): PlanChainMonth[] {
  const {
    anchorBalance, today, currentMonth, monthsAhead, chequingId,
    datedTransactions, cards, cardBudgetRows, cardTransactions,
    unanchoredIncomeCount, unanchoredExpenseCount,
  } = params;
  const accounts = params.accounts ?? [{ id: chequingId, type: 'chequing' }];
  const transferPeers = params.transferPeers ?? [];
  const recurringItems = params.recurringItems ?? [];

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

    const startBalance = balance;
    balance = r2(balance + dated.income - dated.expenses - cardCostResult.total);

    // The SAME row filter computeDatedRangeTotals applies — chequing, not a
    // card payment, inside the range.
    const monthRows = datedTransactions.filter(
      (t) => t.account_id === chequingId && !t.is_bridge && t.date >= rangeStart && t.date <= rangeEnd
    );

    months.push({
      month, rangeStart, rangeEnd, isPartialMonth,
      startBalance,
      income: dated.income,
      datedExpenses: dated.expenses,
      cardCost: cardCostResult.terms,
      cardCostTotal: cardCostResult.total,
      balance,
      breakdown: computeMonthBreakdown({
        monthRows, peerRows: transferPeers, accounts,
        chainIncome: dated.income, chainExpenses: dated.expenses, cardCostTotal: cardCostResult.total,
      }),
      extraPayments: findExtraPayments(monthRows, recurringItems),
      why: null,
      unanchoredIncomeCount,
      unanchoredExpenseCount,
    });
  }

  return months;
}
