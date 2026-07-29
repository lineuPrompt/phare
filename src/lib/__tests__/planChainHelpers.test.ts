import { describe, it, expect } from 'vitest';
import {
  computeDatedRangeTotals,
  computeMonthCardCost,
  resolveCardBudgetsForCycle,
  buildPlanChain,
  type ChequingChainTx,
} from '../planChainHelpers';
import { buildCashTimeline, type TimelineTx } from '../timelineHelpers';

const CHEQUING = 'chq-1';
const CARD_A = 'card-a';
const CARD_B = 'card-b';

function tx(overrides: Partial<ChequingChainTx> & { date: string; amount: number; type: string }): ChequingChainTx {
  return { account_id: CHEQUING, recurring_item_id: null, is_bridge: false, ...overrides };
}

let seq = 0;
function timelineTx(overrides: Partial<TimelineTx> & { date: string; amount: number; type: 'income' | 'expense' | 'transfer' }): TimelineTx {
  seq += 1;
  return {
    id: `t${seq}`, description: null, recurringItemId: null, recurrenceId: null,
    installmentLabel: null, transferPeerId: null, isBridge: false,
    bridgeSourceAccount: null, bridgeSourceMonth: null,
    ...overrides,
  };
}

// ── computeDatedRangeTotals — every type, signed via timelineHelpers.signAmount ──

describe('computeDatedRangeTotals', () => {
  it('sums every dated chequing row in the range, recurring-linked or not', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-10', amount: 3000, type: 'income', recurring_item_id: 'ri-1' }),
      tx({ date: '2026-09-01', amount: 1500, type: 'expense', recurring_item_id: 'ri-2' }),
      // Manual, non-recurring — must count, same as a recurring row.
      tx({ date: '2026-09-05', amount: 80, type: 'expense', recurring_item_id: null }),
    ];
    const { income, expenses } = computeDatedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(income).toBe(3000);
    expect(expenses).toBe(1580); // 1500 + 80
  });

  it('counts a dated, non-recurring INCOME row too (the fix removed the filter for both directions)', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-12', amount: 150, type: 'income', recurring_item_id: null }), // manual, one-off income
    ];
    const { income } = computeDatedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(income).toBe(150);
  });

  it('a transfer CONTRIBUTION (positive amount) counts as an outflow, matching the real walk', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-05', amount: 350, type: 'transfer' }),
    ];
    const { expenses } = computeDatedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(expenses).toBe(350);
  });

  it('a transfer DRAW (negative amount) counts as an INFLOW, never hardcoded as an outflow', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-09-05', amount: -400, type: 'transfer' }), // debt draw, stored negative
    ];
    const { income, expenses } = computeDatedRangeTotals(rows, CHEQUING, { start: '2026-09-01', end: '2026-09-30' });
    expect(income).toBe(400);
    expect(expenses).toBe(0);
  });

  it('excludes bridge rows structurally regardless of type or recurring_item_id', () => {
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

// ── PROPERTY: agreement with the real ledger walk, not a hardcoded number ───

describe('PROPERTY: dated totals agree with buildCashTimeline (the real walk), for every type', () => {
  it('income, expense, transfer-contribution, and transfer-draw all net identically to the real walk', () => {
    const anchorBalance = 1000;
    const rangeStart = '2026-07-16';
    const rangeEnd = '2026-07-31';

    const rawRows: { date: string; amount: number; type: 'income' | 'expense' | 'transfer' }[] = [
      { date: '2026-07-20', amount: 500, type: 'income' },
      { date: '2026-07-21', amount: 200, type: 'expense' },
      { date: '2026-07-22', amount: 350, type: 'transfer' }, // contribution: stored positive, an outflow
      { date: '2026-07-23', amount: -400, type: 'transfer' }, // draw: stored negative, an inflow
    ];

    const realWalk = buildCashTimeline({
      anchors: [{ date: rangeStart, balance: anchorBalance }],
      transactions: rawRows.map((r) => timelineTx(r)),
      windowStart: rangeStart,
      windowEnd: rangeEnd,
      today: rangeEnd,
    });
    if (!realWalk.ok) throw new Error('expected buildCashTimeline to resolve');

    const chainRows: ChequingChainTx[] = rawRows.map((r) => tx(r));
    const { income, expenses } = computeDatedRangeTotals(chainRows, CHEQUING, { start: rangeStart, end: rangeEnd });
    const planEquivalentClose = Math.round((anchorBalance + income - expenses) * 100) / 100;

    expect(planEquivalentClose).toBe(realWalk.closingBalance);
  });

  it('a bridge row breaks agreement with the real walk BY DESIGN — the plan substitutes its own card-cost term instead', () => {
    // Documents the one deliberate divergence: bridges are excluded from
    // the dated basis (computeMonthCardCost adds its own term), so a real
    // walk that includes a bridge legitimately disagrees with the
    // bridge-excluded dated total alone. Never true for any other type.
    const anchorBalance = 1000;
    const rangeStart = '2026-07-16';
    const rangeEnd = '2026-07-31';
    const bridgeRow = { date: '2026-07-20', amount: 300, type: 'expense' as const };

    const realWalk = buildCashTimeline({
      anchors: [{ date: rangeStart, balance: anchorBalance }],
      transactions: [{ ...timelineTx(bridgeRow), isBridge: true }],
      windowStart: rangeStart, windowEnd: rangeEnd, today: rangeEnd,
    });
    if (!realWalk.ok) throw new Error('expected ok');

    const { income, expenses } = computeDatedRangeTotals(
      [tx({ ...bridgeRow, is_bridge: true })], CHEQUING, { start: rangeStart, end: rangeEnd }
    );
    expect(anchorBalance + income - expenses).not.toBe(realWalk.closingBalance);
    expect(expenses).toBe(0); // excluded, not merely mismatched
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
    expect(b.basis).toBe('actual'); // calendar-month cycle, always closed one month later
    expect(b.amount).toBeGreaterThan(0);
    expect(total).toBe(b.amount);
  });

  it('every card excluded when excludeAlreadyPosted is false (later chain months never see "posted")', () => {
    const { terms } = computeMonthCardCost({
      cards: [CARDS[0]],
      cardBudgets: new Map([[CARD_A, 400]]),
      transactions: [{ account_id: CARD_A, date: '2026-08-15', type: 'expense', amount: 0 }],
      cycleMonth: '2026-08',
      today: '2026-07-10',
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
      const expected = Math.round((running + m.income - m.datedExpenses - m.cardCostTotal) * 100) / 100;
      expect(m.balance).toBe(expected);
      running = m.balance;
    }
  });

  it('month 1 only counts dated rows strictly after today', () => {
    const months = buildPlanChain(baseParams);
    expect(months[0].income).toBe(0);
    expect(months[0].datedExpenses).toBe(0);
    expect(months[1].income).toBe(4000);
    expect(months[1].datedExpenses).toBe(1500);
  });

  it('a bridge row inside the dated-transactions basis never leaks into datedExpenses (structural exclusion)', () => {
    const withBridge: ChequingChainTx[] = [
      ...datedTransactions,
      tx({ date: '2026-08-10', amount: 2249.79, type: 'expense', is_bridge: true }),
    ];
    const months = buildPlanChain({ ...baseParams, datedTransactions: withBridge });
    expect(months[1].datedExpenses).toBe(1500);
  });

  it('a dated transfer-draw RAISES the plan; a dated transfer-contribution LOWERS it — matching the real walk', () => {
    const withDraw = buildPlanChain({
      ...baseParams,
      datedTransactions: [...datedTransactions, tx({ date: '2026-07-20', amount: -400, type: 'transfer' })],
    });
    const withContribution = buildPlanChain({
      ...baseParams,
      datedTransactions: [...datedTransactions, tx({ date: '2026-07-20', amount: 400, type: 'transfer' })],
    });
    const baseline = buildPlanChain(baseParams);

    expect(withDraw[0].balance).toBe(Math.round((baseline[0].balance + 400) * 100) / 100);
    expect(withContribution[0].balance).toBe(Math.round((baseline[0].balance - 400) * 100) / 100);
  });

  it('zero-impact invariant: a household with no card-cost chains purely off dated income/expense', () => {
    const months = buildPlanChain(baseParams);
    expect(months.every((m) => m.cardCostTotal === 0)).toBe(true);
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
    expect(months[1].cardCost.every((c) => c.basis !== 'posted')).toBe(true);
  });

  it('unanchored recurring counts are disclosed on every month of the chain, not a single global badge', () => {
    const months = buildPlanChain({ ...baseParams, unanchoredIncomeCount: 2, unanchoredExpenseCount: 1 });
    expect(months.every((m) => m.unanchoredIncomeCount === 2 && m.unanchoredExpenseCount === 1)).toBe(true);
  });
});

// ── THE INVARIANT — month 1 never exceeds the real close, and equals it exactly when closed ──

describe('THE INVARIANT: month 1 vs. the real ledger close', () => {
  const anchorBalance = 1000;
  const today = '2026-07-15';

  it('equals the real close exactly when nothing is left to substitute (no open card cycles)', () => {
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-07-16', amount: 4000, type: 'income', recurring_item_id: 'ri-pay' }),
      tx({ date: '2026-07-20', amount: 500, type: 'expense', recurring_item_id: null }),
      tx({ date: '2026-07-25', amount: 1200, type: 'expense', recurring_item_id: 'ri-rent' }),
    ];
    const realClose = anchorBalance + 4000 - 500 - 1200;

    const months = buildPlanChain({
      anchorBalance, today, currentMonth: '2026-07', monthsAhead: 1, chequingId: CHEQUING,
      datedTransactions: rows, cards: [], cardBudgetRows: [], cardTransactions: [],
      unanchoredIncomeCount: 0, unanchoredExpenseCount: 0,
    });

    expect(months[0].cardCostTotal).toBe(0);
    expect(months[0].balance).toBe(realClose);
  });

  it('CONSEQUENCE: equals the real close exactly for the real July/August shape — a dated transfer-contribution, a recurring expense, a recurring income, and every card already closed', () => {
    // The exact shape that produced the reported $350 gap: a real,
    // recurring-linked SAVINGS TRANSFER dated in the remainder of the
    // month, alongside ordinary recurring income/expense, with every
    // relevant card cycle already closed (nothing to substitute).
    const rows: ChequingChainTx[] = [
      tx({ date: '2026-07-30', amount: 350, type: 'transfer', recurring_item_id: 'ri-savings' }),
      tx({ date: '2026-07-30', amount: 173.61, type: 'expense', recurring_item_id: 'ri-car' }),
      tx({ date: '2026-07-30', amount: 2750, type: 'income', recurring_item_id: 'ri-salary' }),
    ];
    const cards = [{ id: CARD_A, name: 'Visa', statement_close_day: null, payment_day: 1 }]; // posted well before today

    const months = buildPlanChain({
      anchorBalance, today, currentMonth: '2026-07', monthsAhead: 1, chequingId: CHEQUING,
      datedTransactions: rows, cards,
      cardBudgetRows: [{ account_id: CARD_A, card_goal: 500, month: '2026-01-01' }],
      cardTransactions: [{ account_id: CARD_A, date: '2026-06-10', type: 'expense', amount: 200 }],
      unanchoredIncomeCount: 0, unanchoredExpenseCount: 0,
    });

    const realClose = anchorBalance + 2750 - 173.61 - 350; // income − expense − transfer-contribution
    expect(months[0].cardCostTotal).toBe(0); // posted — already inside the anchor
    expect(months[0].balance).toBe(Math.round(realClose * 100) / 100);
  });

  it('falls strictly below the dated-only total when a legitimate forward assumption applies (closed cycle, not yet posted)', () => {
    const rows: ChequingChainTx[] = [];
    const datedOnlyClose = anchorBalance;

    const months = buildPlanChain({
      anchorBalance, today, currentMonth: '2026-07', monthsAhead: 1, chequingId: CHEQUING,
      datedTransactions: rows,
      cards: [{ id: CARD_A, name: 'Visa', statement_close_day: null, payment_day: 25 }], // not yet posted
      cardBudgetRows: [],
      cardTransactions: [{ account_id: CARD_A, date: '2026-06-10', type: 'expense', amount: 150 }],
      unanchoredIncomeCount: 0, unanchoredExpenseCount: 0,
    });

    expect(months[0].cardCost[0].basis).toBe('actual');
    expect(months[0].cardCostTotal).toBe(150);
    expect(months[0].balance).toBeLessThan(datedOnlyClose);
  });
});
