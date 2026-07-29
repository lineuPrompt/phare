import { describe, it, expect } from 'vitest';
import {
  computeDatedRangeTotals,
  computeVariableRangeTotal,
  computeTrailingVariableMonthlyTotal,
  computeTrailingVariableAverage,
  computeMonthCardCost,
  resolveCardBudgetsForCycle,
  buildPlanChain,
  type ChequingChainTx,
} from '../planChainHelpers';

const CHEQUING = 'chq-1';
const CARD_A = 'card-a';
const CARD_B = 'card-b';

function tx(overrides: Partial<ChequingChainTx> & { date: string; amount: number; type: string }): ChequingChainTx {
  return { account_id: CHEQUING, recurring_item_id: null, is_bridge: false, ...overrides };
}

// ── computeDatedRangeTotals (BUG 1 FIX: dated, not fixed) ───────────────────

describe('computeDatedRangeTotals', () => {
  it('sums every dated chequing row in the range, recurring-linked or not', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-10', amount: 3000, type: 'income', recurring_item_id: 'ri-1' }),
      tx({ date: '2026-09-01', amount: 1500, type: 'expense', recurring_item_id: 'ri-2' }),
      // Manual, non-recurring — BUG 1: this used to be dropped. It's a real
      // dated fact and must count now, same as a recurring row.
      tx({ date: '2026-09-05', amount: 80, type: 'expense', recurring_item_id: null }),
    ];
    const { income, expenses } = computeDatedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(income).toBe(3000);
    expect(expenses).toBe(1580); // 1500 + 80, not just 1500
  });

  it('excludes bridge rows structurally regardless of recurring_item_id', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-15', amount: 200, type: 'expense', recurring_item_id: null, is_bridge: true }),
    ];
    const { expenses } = computeDatedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(expenses).toBe(0);
  });

  it('excludes rows on other accounts (e.g. a card-charged recurring subscription)', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-10', amount: 15, type: 'expense', recurring_item_id: 'ri-sub', account_id: CARD_A }),
    ];
    const { expenses } = computeDatedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(expenses).toBe(0);
  });

  it('an empty range (start after end) yields zeros, not an error', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-15', amount: 999, type: 'income', recurring_item_id: 'ri-1' }),
    ];
    const { income, expenses } = computeDatedRangeTotals(rows, CHEQUING, { start: '2026-09-30', end: '2026-09-29' });
    expect(income).toBe(0);
    expect(expenses).toBe(0);
  });
});

// ── Variable spend: range total, trailing monthly total, trailing average ──

describe('computeVariableRangeTotal / computeTrailingVariableMonthlyTotal', () => {
  it('sums chequing expense rows with no recurring link and no bridge flag', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-06-03', amount: 120, type: 'expense' }),
      tx({ date: '2026-06-18', amount: 45, type: 'expense' }),
      tx({ date: '2026-06-20', amount: 3000, type: 'income' }), // income excluded
      tx({ date: '2026-06-05', amount: 500, type: 'expense', recurring_item_id: 'ri-1' }), // fixed, excluded
      tx({ date: '2026-06-06', amount: 200, type: 'expense', is_bridge: true }), // bridge, excluded
      tx({ date: '2026-06-07', amount: 999, type: 'expense', account_id: CARD_A }), // card, excluded
    ];
    const total = computeTrailingVariableMonthlyTotal(rows, CHEQUING, '2026-06');
    expect(total).toBe(165);
    // Same result via the underlying range function directly.
    expect(computeVariableRangeTotal(rows, CHEQUING, { start: '2026-06-01', end: '2026-06-30' })).toBe(165);
  });
});

describe('computeTrailingVariableAverage (BUG 2 FIX: no dilution by empty months)', () => {
  it('averages only months with real data — 1 real month + 2 empty ones gives the real figure, not a third', () => {
    const months = [
      { month: '2026-04', total: 0, hasRealData: false },
      { month: '2026-05', total: 0, hasRealData: false },
      { month: '2026-06', total: 300, hasRealData: true },
    ];
    expect(computeTrailingVariableAverage(months)).toBe(300); // not 100
  });

  it('averages plainly across months that all have real data', () => {
    const months = [
      { month: '2026-04', total: 100, hasRealData: true },
      { month: '2026-05', total: 200, hasRealData: true },
      { month: '2026-06', total: 300, hasRealData: true },
    ];
    expect(computeTrailingVariableAverage(months)).toBe(200);
  });

  it('returns null (unavailable) when zero trailing months have real data — never a fabricated 0', () => {
    const months = [
      { month: '2026-04', total: 0, hasRealData: false },
      { month: '2026-05', total: 0, hasRealData: false },
      { month: '2026-06', total: 0, hasRealData: false },
    ];
    expect(computeTrailingVariableAverage(months)).toBeNull();
  });

  it('a household with real data but genuinely zero variable spend correctly averages to 0 (a real measurement, not dilution)', () => {
    const months = [
      { month: '2026-04', total: 0, hasRealData: true },
      { month: '2026-05', total: 0, hasRealData: true },
      { month: '2026-06', total: 0, hasRealData: true },
    ];
    expect(computeTrailingVariableAverage(months)).toBe(0);
  });

  it('an empty list averages to null, never invents a figure', () => {
    expect(computeTrailingVariableAverage([])).toBeNull();
  });
});

// ── computeMonthCardCost — closed/open/max, and the month-1 boundary ────────

const CARDS = [
  { id: CARD_A, name: 'Visa', statement_close_day: null, payment_day: 5 },
  { id: CARD_B, name: 'Amex', statement_close_day: null, payment_day: 20 },
];

describe('computeMonthCardCost', () => {
  it('closed cycle uses actual', () => {
    const { terms } = computeMonthCardCost({
      cards: [CARDS[0]],
      cardBudgets: new Map([[CARD_A, 500]]),
      transactions: [{ account_id: CARD_A, date: '2026-06-10', type: 'expense', amount: 100 }],
      cycleMonth: '2026-06',
      today: '2026-07-05',
      excludeAlreadyPosted: false,
    });
    expect(terms[0].basis).toBe('actual');
    expect(terms[0].amount).toBe(100);
  });

  it('open cycle under budget uses budget', () => {
    const { terms } = computeMonthCardCost({
      cards: [CARDS[0]],
      cardBudgets: new Map([[CARD_A, 500]]),
      transactions: [{ account_id: CARD_A, date: '2026-07-05', type: 'expense', amount: 200 }],
      cycleMonth: '2026-07',
      today: '2026-07-20',
      excludeAlreadyPosted: false,
    });
    expect(terms[0].basis).toBe('budget');
    expect(terms[0].amount).toBe(500);
  });

  it('open cycle already over budget uses max (actual)', () => {
    const { terms } = computeMonthCardCost({
      cards: [CARDS[0]],
      cardBudgets: new Map([[CARD_A, 500]]),
      transactions: [{ account_id: CARD_A, date: '2026-07-05', type: 'expense', amount: 650 }],
      cycleMonth: '2026-07',
      today: '2026-07-20',
      excludeAlreadyPosted: false,
    });
    expect(terms[0].basis).toBe('max');
    expect(terms[0].amount).toBe(650);
  });

  it('open cycle with no budget set uses actual-so-far', () => {
    const { terms } = computeMonthCardCost({
      cards: [CARDS[0]],
      cardBudgets: new Map(),
      transactions: [{ account_id: CARD_A, date: '2026-07-05', type: 'expense', amount: 50 }],
      cycleMonth: '2026-07',
      today: '2026-07-20',
      excludeAlreadyPosted: false,
    });
    expect(terms[0].basis).toBe('actual');
    expect(terms[0].amount).toBe(50);
  });

  // ── THE MONTH-1 BOUNDARY — pinned per the founder's explicit requirement ──
  it('month-1 boundary: two cards on different payment days, one already posted into the anchor, one not', () => {
    // today = 2026-07-10. Card A pays on the 5th (already passed — its bridge
    // for this cycle is already inside todayBalance). Card B pays on the 20th
    // (still ahead — not yet reflected anywhere, needs a fresh term).
    const { terms, total } = computeMonthCardCost({
      cards: CARDS, // A: payment_day 5, B: payment_day 20
      cardBudgets: new Map([[CARD_A, 400], [CARD_B, 300]]),
      transactions: [
        { account_id: CARD_A, date: '2026-06-15', type: 'expense', amount: 350 },
        { account_id: CARD_B, date: '2026-06-15', type: 'expense', amount: 100 },
      ],
      cycleMonth: '2026-06', // payment lands in 2026-07
      today: '2026-07-10',
      excludeAlreadyPosted: true, // month-1 only
    });

    const a = terms.find((t) => t.cardId === CARD_A)!;
    const b = terms.find((t) => t.cardId === CARD_B)!;

    expect(a.basis).toBe('posted');
    expect(a.amount).toBe(0); // already inside the anchor — no double count

    // Cycle month 2026-06 with no statement_close_day falls back to the
    // calendar month, so by 2026-07-10 the cycle (ending 2026-06-30) is
    // already closed — its basis is 'actual', not a budget guess.
    expect(b.basis).toBe('actual');
    expect(b.amount).toBeGreaterThan(0);

    expect(total).toBe(b.amount); // A contributes 0, so total === B's amount alone
  });

  it('every card excluded when excludeAlreadyPosted is false (later chain months never see "posted")', () => {
    const { terms } = computeMonthCardCost({
      cards: [CARDS[0]],
      cardBudgets: new Map([[CARD_A, 400]]),
      transactions: [{ account_id: CARD_A, date: '2026-08-15', type: 'expense', amount: 0 }],
      cycleMonth: '2026-08',
      today: '2026-07-10', // long before this cycle's payment date
      excludeAlreadyPosted: false,
    });
    expect(terms[0].basis).not.toBe('posted');
  });
});

// ── resolveCardBudgetsForCycle ───────────────────────────────────────────────

describe('resolveCardBudgetsForCycle', () => {
  it('carries the latest budget at or before the cycle month forward', () => {
    const rows = [
      { account_id: CARD_A, card_goal: 400, month: '2026-05-01' },
      { account_id: CARD_A, card_goal: 500, month: '2026-07-01' },
    ];
    expect(resolveCardBudgetsForCycle(rows, '2026-09').get(CARD_A)).toBe(500);
    expect(resolveCardBudgetsForCycle(rows, '2026-06').get(CARD_A)).toBe(400);
    expect(resolveCardBudgetsForCycle(rows, '2026-04').get(CARD_A)).toBeUndefined();
  });

  it('is order-independent', () => {
    const rows = [
      { account_id: CARD_A, card_goal: 500, month: '2026-07-01' },
      { account_id: CARD_A, card_goal: 400, month: '2026-05-01' },
    ];
    expect(resolveCardBudgetsForCycle(rows, '2026-09').get(CARD_A)).toBe(500);
  });
});

// ── buildPlanChain — the full chain, including the recurrence invariant ─────

describe('buildPlanChain', () => {
  const datedTransactions: ChequingChainTx[] = [];
  // Materialize a simple monthly salary + rent for 12 months from July 2026.
  for (let i = 0; i < 12; i++) {
    const m = 7 + i;
    const year = 2026 + Math.floor((m - 1) / 12);
    const month = String(((m - 1) % 12) + 1).padStart(2, '0');
    datedTransactions.push(tx({ date: `${year}-${month}-01`, amount: 4000, type: 'income', recurring_item_id: 'ri-pay' }));
    datedTransactions.push(tx({ date: `${year}-${month}-03`, amount: 1500, type: 'expense', recurring_item_id: 'ri-rent' }));
  }

  const baseParams = {
    anchorBalance: 1000,
    today: '2026-07-15',
    currentMonth: '2026-07',
    monthsAhead: 12,
    chequingId: CHEQUING,
    datedTransactions,
    cards: [],
    cardBudgetRows: [],
    cardTransactions: [],
    variableEstimateMonthly: null as number | null,
    unanchoredIncomeCount: 0,
    unanchoredExpenseCount: 0,
  };

  it('produces exactly monthsAhead sequential months', () => {
    const months = buildPlanChain(baseParams);
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.month)).toEqual([
      '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12',
      '2027-01', '2027-02', '2027-03', '2027-04', '2027-05', '2027-06',
    ]);
    expect(months[0].isPartialMonth).toBe(true);
    expect(months.slice(1).every((m) => !m.isPartialMonth)).toBe(true);
  });

  it('THE CHAIN RECURRENCE INVARIANT: each month equals the previous exactly, by construction', () => {
    const months = buildPlanChain(baseParams);
    let running = baseParams.anchorBalance;
    for (const m of months) {
      const expected = Math.round((running + m.income - m.datedExpenses - m.cardCostTotal - m.variableEstimate) * 100) / 100;
      expect(m.balance).toBe(expected);
      running = m.balance;
    }
  });

  it('month 1 only counts dated rows strictly after today (July 1 rent already happened, excluded)', () => {
    const months = buildPlanChain(baseParams);
    // Rent posted July 3, before today (July 15) — must not appear in month 1.
    // Salary posted July 1, also before today — excluded too.
    expect(months[0].income).toBe(0);
    expect(months[0].datedExpenses).toBe(0);
    // August is a full future month — both terms present.
    expect(months[1].income).toBe(4000);
    expect(months[1].datedExpenses).toBe(1500);
  });

  it('BUG 1 REGRESSION: a dated non-recurring expense in the remainder of the current month is counted, not dropped', () => {
    const withManualExpense: ChequingChainTx[] = [
      ...datedTransactions,
      tx({ date: '2026-07-20', amount: 350, type: 'expense', recurring_item_id: null }), // exact shape of the real bug
    ];
    const months = buildPlanChain({ ...baseParams, datedTransactions: withManualExpense });
    expect(months[0].datedExpenses).toBe(350);
  });

  it('a bridge row inside the dated-transactions basis never leaks into datedExpenses (structural exclusion)', () => {
    const withBridge: ChequingChainTx[] = [
      ...datedTransactions,
      tx({ date: '2026-08-10', amount: 2249.79, type: 'expense', is_bridge: true }),
    ];
    const months = buildPlanChain({ ...baseParams, datedTransactions: withBridge });
    // August's datedExpenses is still just the 1500 rent — the bridge amount never entered the sum.
    expect(months[1].datedExpenses).toBe(1500);
  });

  it('zero-impact invariant: a household with no card-cost and no variable spend chains purely off dated income/expense', () => {
    const months = buildPlanChain(baseParams);
    expect(months.every((m) => m.cardCostTotal === 0)).toBe(true);
    expect(months.every((m) => m.variableEstimate === 0)).toBe(true);
  });

  it('null variableEstimateMonthly (unavailable) applies as 0, never fabricates a figure', () => {
    const months = buildPlanChain({ ...baseParams, variableEstimateMonthly: null });
    expect(months.every((m) => m.variableEstimate === 0)).toBe(true);
  });

  it('variable estimate is prorated for the partial first month, flat for later months, when nothing is already dated', () => {
    const months = buildPlanChain({ ...baseParams, variableEstimateMonthly: 310 });
    // July 2026 has 31 days; today=2026-07-15, so remaining days = 16 (16..31 inclusive).
    expect(months[0].variableEstimate).toBe(Math.round((310 * 16 / 31) * 100) / 100);
    expect(months[1].variableEstimate).toBe(310);
  });

  // ── NETTING — narrower rule: month 1 nets, months 2-12 never do ──────────
  it('month 1 nets the prorated estimate against dated non-recurring spend in the same window', () => {
    const withDatedVariable: ChequingChainTx[] = [
      ...datedTransactions,
      tx({ date: '2026-07-20', amount: 100, type: 'expense', recurring_item_id: null }), // dated "groceries"-style spend
    ];
    const months = buildPlanChain({ ...baseParams, datedTransactions: withDatedVariable, variableEstimateMonthly: 310 });
    const prorated = Math.round((310 * 16 / 31) * 100) / 100; // ~160.00
    expect(months[0].variableEstimate).toBe(Math.round(Math.max(0, prorated - 100) * 100) / 100);
    expect(months[0].variableEstimate).toBeLessThan(prorated);
  });

  it('month 1 netting floors at 0 — a dated expense larger than the prorated estimate never goes negative', () => {
    const withLargeDatedVariable: ChequingChainTx[] = [
      ...datedTransactions,
      tx({ date: '2026-07-20', amount: 5000, type: 'expense', recurring_item_id: null }),
    ];
    const months = buildPlanChain({ ...baseParams, datedTransactions: withLargeDatedVariable, variableEstimateMonthly: 310 });
    expect(months[0].variableEstimate).toBe(0);
  });

  it('months 2-12 do NOT net a dated one-off against the flat estimate — an installment is additional, not a substitute (founder example)', () => {
    const withFutureInstallment: ChequingChainTx[] = [
      ...datedTransactions,
      tx({ date: '2026-08-15', amount: 500, type: 'expense', recurring_item_id: null }), // a dated $500 installment in August
    ];
    const months = buildPlanChain({ ...baseParams, datedTransactions: withFutureInstallment, variableEstimateMonthly: 310 });
    // August's datedExpenses now includes the installment (1500 rent + 500 installment)...
    expect(months[1].datedExpenses).toBe(2000);
    // ...AND the full flat variable estimate is still subtracted on top, unnetted.
    expect(months[1].variableEstimate).toBe(310);
  });

  it('propagates the month-1 card boundary through the full chain (no double count at the seam)', () => {
    const cards = [
      { id: CARD_A, name: 'Visa', statement_close_day: null, payment_day: 5 }, // already posted by July 15
      { id: CARD_B, name: 'Amex', statement_close_day: null, payment_day: 25 }, // still ahead
    ];
    const cardTransactions = [
      { account_id: CARD_A, date: '2026-06-10', type: 'expense', amount: 300 },
      { account_id: CARD_B, date: '2026-06-10', type: 'expense', amount: 200 },
    ];
    const months = buildPlanChain({
      ...baseParams, cards, cardTransactions,
      cardBudgetRows: [{ account_id: CARD_A, card_goal: 300, month: '2026-01-01' }, { account_id: CARD_B, card_goal: 200, month: '2026-01-01' }],
    });
    const cardAInMonth1 = months[0].cardCost.find((c) => c.cardId === CARD_A)!;
    const cardBInMonth1 = months[0].cardCost.find((c) => c.cardId === CARD_B)!;
    expect(cardAInMonth1.basis).toBe('posted');
    expect(cardAInMonth1.amount).toBe(0);
    expect(cardBInMonth1.amount).toBeGreaterThan(0);
    // Month 2 (August) — cycle month July — neither card's "posted" special case applies.
    expect(months[1].cardCost.every((c) => c.basis !== 'posted')).toBe(true);
  });

  it('unanchored recurring counts are disclosed on every month of the chain, not a single global badge', () => {
    const months = buildPlanChain({ ...baseParams, unanchoredIncomeCount: 2, unanchoredExpenseCount: 1 });
    expect(months.every((m) => m.unanchoredIncomeCount === 2 && m.unanchoredExpenseCount === 1)).toBe(true);
  });
});

// ── THE INVARIANT — month 1 must never exceed the real close ────────────────

describe('THE INVARIANT: month 1 never exceeds the real ledger close', () => {
  const anchorBalance = 1000;
  const today = '2026-07-15';

  it('equals the real close exactly when nothing is left to assume (no cards, no variable estimate)', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-07-16', amount: 4000, type: 'income', recurring_item_id: 'ri-pay' }),
      tx({ date: '2026-07-20', amount: 500, type: 'expense', recurring_item_id: null }), // dated, manual
      tx({ date: '2026-07-25', amount: 1200, type: 'expense', recurring_item_id: 'ri-rent' }),
    ];
    // The real ledger walk would sum every one of these the same way.
    const realClose = anchorBalance + 4000 - 500 - 1200;

    const months = buildPlanChain({
      anchorBalance, today, currentMonth: '2026-07', monthsAhead: 1, chequingId: CHEQUING,
      datedTransactions: rows, cards: [], cardBudgetRows: [], cardTransactions: [],
      variableEstimateMonthly: null, unanchoredIncomeCount: 0, unanchoredExpenseCount: 0,
    });

    expect(months[0].cardCostTotal + months[0].variableEstimate).toBe(0);
    expect(months[0].balance).toBe(realClose);
  });

  it('BUG 1 REGRESSION (the exact July shape): a dated non-recurring expense must not make the plan exceed the real close', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-07-20', amount: 350, type: 'expense', recurring_item_id: null }),
    ];
    const realClose = anchorBalance - 350;

    const months = buildPlanChain({
      anchorBalance, today, currentMonth: '2026-07', monthsAhead: 1, chequingId: CHEQUING,
      datedTransactions: rows, cards: [], cardBudgetRows: [], cardTransactions: [],
      variableEstimateMonthly: null, unanchoredIncomeCount: 0, unanchoredExpenseCount: 0,
    });

    expect(months[0].balance).toBe(realClose); // 650, not 1000 — the bug would have produced 1000
    expect(months[0].balance).toBeLessThanOrEqual(anchorBalance);
  });

  it('falls strictly below the dated-only total when a legitimate forward assumption applies (closed cycle, not yet posted)', () => {
    // Month 1's relevant cycle (currentMonth − 1) is always entirely within
    // the PREVIOUS calendar month, so by the time "today" is in the current
    // month it can never still be open (statementCycleWindow's end always
    // falls inside that prior month) — it's either 'posted' (already inside
    // the anchor) or 'actual' with a real, not-yet-posted amount. This tests
    // the latter: real June spend, payment_day (25) still ahead of today
    // (15), so it hasn't posted yet and must still reduce the plan.
    const rows: ChequingChainTx[] = [];
    const datedOnlyClose = anchorBalance; // nothing dated at all in the remainder

    const months = buildPlanChain({
      anchorBalance, today, currentMonth: '2026-07', monthsAhead: 1, chequingId: CHEQUING,
      datedTransactions: rows,
      cards: [{ id: CARD_A, name: 'Visa', statement_close_day: null, payment_day: 25 }], // not yet posted
      cardBudgetRows: [],
      cardTransactions: [{ account_id: CARD_A, date: '2026-06-10', type: 'expense', amount: 150 }],
      variableEstimateMonthly: null, unanchoredIncomeCount: 0, unanchoredExpenseCount: 0,
    });

    expect(months[0].cardCost[0].basis).toBe('actual');
    expect(months[0].cardCostTotal).toBe(150);
    // A legitimate, not-yet-anchored real cost only ever pulls the plan DOWN
    // relative to the dated-only figure — never above it.
    expect(months[0].balance).toBeLessThan(datedOnlyClose);
  });
});
