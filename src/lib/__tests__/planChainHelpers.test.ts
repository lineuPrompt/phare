import { describe, it, expect } from 'vitest';
import {
  computeFixedRangeTotals,
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

// ── computeFixedRangeTotals ──────────────────────────────────────────────────

describe('computeFixedRangeTotals', () => {
  it('sums only recurring-linked chequing rows inside the range', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-10', amount: 3000, type: 'income', recurring_item_id: 'ri-1' }),
      tx({ date: '2026-09-01', amount: 1500, type: 'expense', recurring_item_id: 'ri-2' }),
      // Manual, non-recurring — never fixed.
      tx({ date: '2026-09-05', amount: 80, type: 'expense', recurring_item_id: null }),
    ];
    const { income, fixedExpenses } = computeFixedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(income).toBe(3000);
    expect(fixedExpenses).toBe(1500);
  });

  it('excludes bridge rows structurally, even one that happens to carry no recurring_item_id (the only way it could appear)', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-15', amount: 200, type: 'expense', recurring_item_id: null, is_bridge: true }),
    ];
    const { fixedExpenses } = computeFixedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(fixedExpenses).toBe(0);
  });

  it('excludes rows on other accounts (e.g. a card-charged recurring subscription)', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-10', amount: 15, type: 'expense', recurring_item_id: 'ri-sub', account_id: CARD_A }),
    ];
    const { fixedExpenses } = computeFixedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(fixedExpenses).toBe(0);
  });

  it('an empty range (start after end) yields zeros, not an error', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-15', amount: 999, type: 'income', recurring_item_id: 'ri-1' }),
    ];
    const { income, fixedExpenses } = computeFixedRangeTotals(rows, CHEQUING, { start: '2026-09-30', end: '2026-09-29' });
    expect(income).toBe(0);
    expect(fixedExpenses).toBe(0);
  });
});

// ── Trailing variable spend (Option B) ───────────────────────────────────────

describe('computeTrailingVariableMonthlyTotal / computeTrailingVariableAverage', () => {
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
  });

  it('a household with zero real chequing-side variable spend gets an average of exactly 0 (zero-impact invariant)', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-06-05', amount: 2000, type: 'expense', recurring_item_id: 'ri-rent' }),
      tx({ date: '2026-06-20', amount: 3000, type: 'income', recurring_item_id: 'ri-pay' }),
    ];
    const months = ['2026-04', '2026-05', '2026-06'].map((m) => computeTrailingVariableMonthlyTotal(rows, CHEQUING, m));
    expect(months).toEqual([0, 0, 0]);
    expect(computeTrailingVariableAverage(months)).toBe(0);
  });

  it('averages plainly across the given trailing months', () => {
    expect(computeTrailingVariableAverage([100, 200, 300])).toBe(200);
  });

  it('an empty trailing window averages to 0, never invents a figure', () => {
    expect(computeTrailingVariableAverage([])).toBe(0);
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
  const fixedTransactions: ChequingChainTx[] = [];
  // Materialize a simple monthly salary + rent for 12 months from July 2026.
  for (let i = 0; i < 12; i++) {
    const m = 7 + i;
    const year = 2026 + Math.floor((m - 1) / 12);
    const month = String(((m - 1) % 12) + 1).padStart(2, '0');
    fixedTransactions.push(tx({ date: `${year}-${month}-01`, amount: 4000, type: 'income', recurring_item_id: 'ri-pay' }));
    fixedTransactions.push(tx({ date: `${year}-${month}-03`, amount: 1500, type: 'expense', recurring_item_id: 'ri-rent' }));
  }

  const baseParams = {
    anchorBalance: 1000,
    today: '2026-07-15',
    currentMonth: '2026-07',
    monthsAhead: 12,
    chequingId: CHEQUING,
    fixedTransactions,
    cards: [],
    cardBudgetRows: [],
    cardTransactions: [],
    variableEstimateMonthly: 0,
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
      const expected = Math.round((running + m.income - m.fixedExpenses - m.cardCostTotal - m.variableEstimate) * 100) / 100;
      expect(m.balance).toBe(expected);
      running = m.balance;
    }
  });

  it('month 1 only counts fixed rows strictly after today (July 1 rent already happened, excluded)', () => {
    const months = buildPlanChain(baseParams);
    // Rent posted July 3, before today (July 15) — must not appear in month 1.
    // Salary posted July 1, also before today — excluded too.
    expect(months[0].income).toBe(0);
    expect(months[0].fixedExpenses).toBe(0);
    // August is a full future month — both terms present.
    expect(months[1].income).toBe(4000);
    expect(months[1].fixedExpenses).toBe(1500);
  });

  it('a bridge row inside the fixed-transactions basis never leaks into fixedExpenses (structural exclusion)', () => {
    const withBridge: ChequingChainTx[] = [
      ...fixedTransactions,
      tx({ date: '2026-08-10', amount: 2249.79, type: 'expense', is_bridge: true }),
    ];
    const months = buildPlanChain({ ...baseParams, fixedTransactions: withBridge });
    // August's fixedExpenses is still just the 1500 rent — the bridge amount never entered the sum.
    expect(months[1].fixedExpenses).toBe(1500);
  });

  it('zero-impact invariant: a household with no card-cost and no variable spend chains purely off fixed income/expense', () => {
    const months = buildPlanChain(baseParams);
    expect(months.every((m) => m.cardCostTotal === 0)).toBe(true);
    expect(months.every((m) => m.variableEstimate === 0)).toBe(true);
  });

  it('variable estimate is prorated for the partial first month, flat for later months', () => {
    const months = buildPlanChain({ ...baseParams, variableEstimateMonthly: 310 });
    // July 2026 has 31 days; today=2026-07-15, so remaining days = 16 (16..31 inclusive).
    expect(months[0].variableEstimate).toBe(Math.round((310 * 16 / 31) * 100) / 100);
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
