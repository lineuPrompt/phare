import { describe, it, expect } from 'vitest';
import {
  categoryActualsForCard,
  uncategorizedSpend,
  totalSpendForCard,
  envelopeRemaining,
  envelopeStatus,
  sumWarning,
  carryForwardMap,
  buildGrid,
  groupEntriesByCategory,
  EnvTx,
  CardTxRow,
} from '../envelopeHelpers';
import { statementCycleWindow, bridgePaymentDate } from '../dateHelpers';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VISA = 'visa-id';
const MC = 'mc-id';
const CAT_GROCERY = 'cat-grocery';
const CAT_REST = 'cat-restaurant';
const CAT_SHOPPING = 'cat-shopping';

function tx(
  account_id: string,
  amount: number,
  date: string,
  category_id: string | null = CAT_GROCERY,
  type = 'expense',
  is_bridge = false
): EnvTx {
  return { account_id, amount, date, category_id, type, is_bridge };
}

const BASE_TXS: EnvTx[] = [
  // Visa — July — categorized
  tx(VISA, 100, '2026-07-05', CAT_GROCERY),
  tx(VISA, 50,  '2026-07-12', CAT_GROCERY),
  tx(VISA, 80,  '2026-07-20', CAT_REST),
  // Visa — July — uncategorized
  tx(VISA, 30,  '2026-07-18', null),
  // Visa — July — bridge (must be excluded)
  tx(VISA, 999, '2026-07-01', CAT_GROCERY, 'expense', true),
  // Visa — August — different month
  tx(VISA, 60,  '2026-08-03', CAT_GROCERY),
  // MasterCard — July — must not bleed into Visa totals
  tx(MC,   400, '2026-07-10', CAT_GROCERY),
  tx(MC,   120, '2026-07-15', CAT_SHOPPING),
];

// ---------------------------------------------------------------------------
// 1. Per-category actuals match the ledger
// ---------------------------------------------------------------------------

describe('categoryActualsForCard', () => {
  it('sums categorized expenses for the target card and month only', () => {
    const result = categoryActualsForCard(BASE_TXS, VISA, '2026-07');
    expect(result.get(CAT_GROCERY)).toBe(150);   // 100 + 50
    expect(result.get(CAT_REST)).toBe(80);
    expect(result.has(CAT_SHOPPING)).toBe(false); // shopping was on MC
  });

  it('excludes bridge lines', () => {
    const result = categoryActualsForCard(BASE_TXS, VISA, '2026-07');
    // Bridge row adds 999 to Grocery — must not appear
    expect(result.get(CAT_GROCERY)).toBe(150);
  });

  it('excludes transactions outside the target month', () => {
    const result = categoryActualsForCard(BASE_TXS, VISA, '2026-07');
    // August Grocery on Visa is 60; should not appear in July result
    expect(result.get(CAT_GROCERY)).toBe(150);
    const aug = categoryActualsForCard(BASE_TXS, VISA, '2026-08');
    expect(aug.get(CAT_GROCERY)).toBe(60);
  });

  it('returns empty map for a month with no transactions', () => {
    const result = categoryActualsForCard(BASE_TXS, VISA, '2026-09');
    expect(result.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 1b. Refunds (income transactions on a card) net against spend, not vanish
// ---------------------------------------------------------------------------

describe('refunds net against category and card actuals', () => {
  const REFUND_TXS: EnvTx[] = [
    tx(VISA, 150, '2026-07-05', CAT_GROCERY),               // spend
    tx(VISA, 40,  '2026-07-10', CAT_GROCERY, 'income'),      // partial refund
    tx(VISA, 999, '2026-07-01', CAT_GROCERY, 'expense', true), // bridge, still excluded
  ];

  it('a refund reduces category Spent', () => {
    const result = categoryActualsForCard(REFUND_TXS, VISA, '2026-07');
    expect(result.get(CAT_GROCERY)).toBe(110); // 150 - 40
  });

  it('a refund reduces card total Spent', () => {
    expect(totalSpendForCard(REFUND_TXS, VISA, '2026-07')).toBe(110);
  });

  it('a refund exceeding spend goes negative honestly, not clamped to zero', () => {
    const bigRefund: EnvTx[] = [
      tx(VISA, 50,  '2026-07-05', CAT_GROCERY),
      tx(VISA, 200, '2026-07-10', CAT_GROCERY, 'income'),
    ];
    const result = categoryActualsForCard(bigRefund, VISA, '2026-07');
    expect(result.get(CAT_GROCERY)).toBe(-150);
    expect(totalSpendForCard(bigRefund, VISA, '2026-07')).toBe(-150);
  });

  it('a refund in a category with no other spend this month is still visible and netted', () => {
    const refundOnly: EnvTx[] = [tx(VISA, 25, '2026-07-10', CAT_SHOPPING, 'income')];
    const result = categoryActualsForCard(refundOnly, VISA, '2026-07');
    expect(result.has(CAT_SHOPPING)).toBe(true);
    expect(result.get(CAT_SHOPPING)).toBe(-25);
  });

  it('an uncategorized refund nets against uncategorized spend', () => {
    const uncatRefund: EnvTx[] = [
      tx(VISA, 100, '2026-07-05', null),
      tx(VISA, 30,  '2026-07-10', null, 'income'),
    ];
    expect(uncategorizedSpend(uncatRefund, VISA, '2026-07')).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// 2. Remaining = sub-budget − actual
// ---------------------------------------------------------------------------

describe('envelopeRemaining', () => {
  it('returns positive number when under budget', () => {
    expect(envelopeRemaining(500, 150)).toBe(350);
  });

  it('returns zero when exactly at budget', () => {
    expect(envelopeRemaining(200, 200)).toBe(0);
  });

  it('returns negative number when over budget', () => {
    expect(envelopeRemaining(100, 130)).toBe(-30);
  });

  it('rounds to 2 decimal places', () => {
    expect(envelopeRemaining(100.33, 33.12)).toBe(67.21);
  });
});

// ---------------------------------------------------------------------------
// 3. ok / watch / over tiers flip at the right boundaries
// ---------------------------------------------------------------------------

describe('envelopeStatus', () => {
  it('ok below 80% of sub-budget', () => {
    expect(envelopeStatus(100, 79.9)).toBe('ok');
  });

  it('watch at exactly 80% of sub-budget', () => {
    expect(envelopeStatus(100, 80.0)).toBe('watch');
  });

  it('watch at exactly 100% of sub-budget (never green at 100%)', () => {
    expect(envelopeStatus(100, 100.0)).toBe('watch');
  });

  it('over just past 100% of sub-budget', () => {
    expect(envelopeStatus(100, 100.1)).toBe('over');
  });

  it('ok when actual is comfortably below sub-budget', () => {
    expect(envelopeStatus(300, 150)).toBe('ok');
  });

  it('unset when sub-budget is zero', () => {
    expect(envelopeStatus(0, 0)).toBe('unset');
    expect(envelopeStatus(0, 50)).toBe('unset');
  });

  it('ok (not over) when actual is negative from a refund', () => {
    expect(envelopeStatus(100, -30)).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// 4. Sum-warning triggers when sub-budgets exceed goal; not when equal/under
// ---------------------------------------------------------------------------

describe('sumWarning', () => {
  const items = [
    { monthlyAmount: 500 },
    { monthlyAmount: 300 },
    { monthlyAmount: 200 },
  ]; // sum = 1000

  it('no warning when sum equals goal', () => {
    expect(sumWarning(items, 1000)).toBe(false);
  });

  it('no warning when sum is under goal', () => {
    expect(sumWarning(items, 1500)).toBe(false);
  });

  it('warning when sum exceeds goal by $0.01', () => {
    expect(sumWarning(items, 999.99)).toBe(true);
  });

  it('warning when sum clearly exceeds goal', () => {
    expect(sumWarning(items, 800)).toBe(true);
  });

  it('no warning with empty items list', () => {
    expect(sumWarning([], 1000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. carryForwardMap — month-scoped snapshots project forward
// ---------------------------------------------------------------------------

describe('carryForwardMap', () => {
  const snaps = new Map<string, string>([
    ['2026-05', 'may-snapshot'],
    ['2026-07', 'july-snapshot'],
  ]);

  it('returns the exact-month snapshot when one was saved', () => {
    expect(carryForwardMap(snaps, '2026-07')).toBe('july-snapshot');
  });

  it('carries forward from the nearest earlier saved month', () => {
    expect(carryForwardMap(snaps, '2026-08')).toBe('july-snapshot');
    expect(carryForwardMap(snaps, '2026-06')).toBe('may-snapshot');
  });

  it('returns null when nothing was ever saved at or before the month', () => {
    expect(carryForwardMap(snaps, '2026-01')).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 6. Forward-looking grid: current month real, future budget-only
// ---------------------------------------------------------------------------

describe('buildGrid', () => {
  const months = ['2026-07', '2026-08'];
  const currentMonth = '2026-07';
  const categoryNames = new Map([
    [CAT_GROCERY, 'Groceries'],
    [CAT_REST, 'Restaurants'],
    [CAT_SHOPPING, 'Shopping'],
  ]);
  const itemSnapshots = new Map([
    ['2026-07', [{ categoryId: CAT_GROCERY, monthlyAmount: 200 }, { categoryId: CAT_REST, monthlyAmount: 100 }]],
  ]);
  const goalsByMonth = new Map([['2026-07', 2000]]);

  it('current month shows real actuals matching categoryActualsForCard', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth);
    const groceryRow = grid.rows.find((r) => r.categoryId === CAT_GROCERY)!;
    expect(groceryRow.actuals[0]).toBe(categoryActualsForCard(BASE_TXS, VISA, '2026-07').get(CAT_GROCERY));
  });

  it('future months are budget-only: actuals null even if transactions exist there', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth);
    const groceryRow = grid.rows.find((r) => r.categoryId === CAT_GROCERY)!;
    // BASE_TXS has a real August Grocery transaction (60), but August is future relative to currentMonth
    expect(groceryRow.actuals[1]).toBe(null);
    expect(grid.totalActuals[1]).toBe(null);
    expect(grid.uncategorizedActuals[1]).toBe(null);
  });

  it('budgets carry forward into months with no explicit save', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth);
    const groceryRow = grid.rows.find((r) => r.categoryId === CAT_GROCERY)!;
    expect(groceryRow.budgets[0]).toBe(200);
    expect(groceryRow.budgets[1]).toBe(200); // carried forward from July
  });

  it('totalGoals carry forward the same way', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth);
    expect(grid.totalGoals[0]).toBe(2000);
    expect(grid.totalGoals[1]).toBe(2000);
  });

  it('uncategorized spend is its own row-equivalent series, not a totals-only ghost', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth);
    expect(grid.uncategorizedActuals[0]).toBe(uncategorizedSpend(BASE_TXS, VISA, '2026-07'));
  });

  it('a category with actual activity but no saved envelope item still appears as a row', () => {
    const refundOnly: EnvTx[] = [tx(VISA, 25, '2026-07-10', CAT_SHOPPING, 'income')];
    const grid = buildGrid(refundOnly, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth);
    const shoppingRow = grid.rows.find((r) => r.categoryId === CAT_SHOPPING);
    expect(shoppingRow).toBeDefined();
    expect(shoppingRow!.budgets[0]).toBe(0); // no envelope item, but visible and netted
    expect(shoppingRow!.actuals[0]).toBe(-25);
  });

  it('totalActuals equal totalSpendForCard for the current month', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth);
    expect(grid.totalActuals[0]).toBe(totalSpendForCard(BASE_TXS, VISA, '2026-07'));
  });
});

// ---------------------------------------------------------------------------
// 7. Uncategorized spend is surfaced, not dropped
// ---------------------------------------------------------------------------

describe('uncategorizedSpend', () => {
  it('returns sum of null-category expenses only', () => {
    expect(uncategorizedSpend(BASE_TXS, VISA, '2026-07')).toBe(30);
  });

  it('is excluded from categoryActualsForCard', () => {
    const actuals = categoryActualsForCard(BASE_TXS, VISA, '2026-07');
    expect(actuals.has(null as unknown as string)).toBe(false);
  });

  it('counts toward totalSpendForCard', () => {
    // Visa July: 100+50 (grocery) + 80 (rest) + 30 (uncategorized) = 260
    expect(totalSpendForCard(BASE_TXS, VISA, '2026-07')).toBe(260);
  });

  it('returns 0 when all transactions are categorized', () => {
    const clean = BASE_TXS.filter((t) => t.category_id !== null);
    expect(uncategorizedSpend(clean, VISA, '2026-07')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Two cards with different goals/categories don't bleed into each other
// ---------------------------------------------------------------------------

describe('card isolation', () => {
  it('categoryActualsForCard on Visa does not include MC transactions', () => {
    const visaActuals = categoryActualsForCard(BASE_TXS, VISA, '2026-07');
    // MC has 400 in Grocery and 120 in Shopping; Visa Grocery is only 150
    expect(visaActuals.get(CAT_GROCERY)).toBe(150);
    expect(visaActuals.has(CAT_SHOPPING)).toBe(false);
  });

  it('categoryActualsForCard on MC does not include Visa transactions', () => {
    const mcActuals = categoryActualsForCard(BASE_TXS, MC, '2026-07');
    expect(mcActuals.get(CAT_GROCERY)).toBe(400);
    expect(mcActuals.get(CAT_SHOPPING)).toBe(120);
    expect(mcActuals.has(CAT_REST)).toBe(false); // Restaurants only on Visa
  });

  it('totalSpendForCard differs per card in the same month', () => {
    const visaTotal = totalSpendForCard(BASE_TXS, VISA, '2026-07');
    const mcTotal   = totalSpendForCard(BASE_TXS, MC,   '2026-07');
    expect(visaTotal).toBe(260);  // 150+80+30
    expect(mcTotal).toBe(520);    // 400+120
    expect(visaTotal).not.toBe(mcTotal);
  });
});

// ---------------------------------------------------------------------------
// 10. Phase 1 fix (post-founder-verification round 2): the Cards page
// display contract is CALENDAR month, always — never the statement cycle.
// The statement cycle governs only which bridge payment date a card's
// spend rolls into (bridgeHelpers.ts / statementCycleWindow). These two
// concerns must never collide: an entry always shows under the calendar
// month of its date, full stop.
// ---------------------------------------------------------------------------

function cardTx(
  id: string,
  amount: number,
  date: string,
  category_id: string | null = CAT_GROCERY,
  type: 'expense' | 'income' = 'expense'
): CardTxRow {
  return { id, account_id: VISA, amount, date, category_id, type, is_bridge: false, description: `entry-${id}`, installment_label: null };
}

describe('groupEntriesByCategory — calendar-month display contract', () => {
  it('groups entries by category, scoped to the calendar month only (no statement-cycle awareness)', () => {
    const { byCategory, uncategorized } = groupEntriesByCategory(
      [
        cardTx('e1', 100, '2026-07-05', CAT_GROCERY),
        cardTx('e2', 50, '2026-07-20', CAT_REST),
        cardTx('e3', 30, '2026-07-18', null),
        cardTx('e4', 999, '2026-08-03', CAT_GROCERY), // different calendar month — excluded
      ],
      VISA,
      '2026-07'
    );
    expect(byCategory[CAT_GROCERY]?.map((e) => e.id)).toEqual(['e1']);
    expect(byCategory[CAT_REST]?.map((e) => e.id)).toEqual(['e2']);
    expect(uncategorized.map((e) => e.id)).toEqual(['e3']);
    expect(byCategory[CAT_GROCERY]?.some((e) => e.id === 'e4')).toBeFalsy();
  });

  it('excludes bridge rows even when dated within the viewed calendar month', () => {
    const bridgeRow: CardTxRow = { id: 'b1', account_id: VISA, amount: 500, date: '2026-07-05', category_id: null, type: 'expense', is_bridge: true, description: 'Visa payment', installment_label: null };
    const { byCategory, uncategorized } = groupEntriesByCategory([bridgeRow], VISA, '2026-07');
    expect(Object.keys(byCategory)).toHaveLength(0);
    expect(uncategorized).toHaveLength(0);
  });

  it(
    'an entry dated on the statement close day and one the day after are BOTH visible under ' +
    'the same calendar month tab, even though they land in different bridge payment cycles',
    () => {
      // Card closes on the 15th. Both entries are July dates, same calendar month.
      const closeDayEntry = cardTx('close-day', 40, '2026-07-15', CAT_GROCERY);
      const dayAfterEntry = cardTx('day-after', 60, '2026-07-16', CAT_GROCERY);

      // Display: both show up under the July calendar-month tab.
      const { byCategory } = groupEntriesByCategory([closeDayEntry, dayAfterEntry], VISA, '2026-07');
      const ids = byCategory[CAT_GROCERY]?.map((e) => e.id) ?? [];
      expect(ids).toEqual(expect.arrayContaining(['close-day', 'day-after']));
      expect(ids).toHaveLength(2);

      // Bridge computation: the two entries fall in DIFFERENT statement
      // cycles and so land on different chequing payment dates.
      const closeDay = 15;
      const paymentDay = 5;
      const julyWindow = statementCycleWindow('2026-07', closeDay); // ends 2026-07-15
      const augustWindow = statementCycleWindow('2026-08', closeDay); // 2026-07-16..2026-08-15

      expect(closeDayEntry.date >= julyWindow.start && closeDayEntry.date <= julyWindow.end).toBe(true);
      expect(dayAfterEntry.date >= augustWindow.start && dayAfterEntry.date <= augustWindow.end).toBe(true);

      const closeDayPaymentDate = bridgePaymentDate('2026-07', paymentDay);
      const dayAfterPaymentDate = bridgePaymentDate('2026-08', paymentDay);
      expect(closeDayPaymentDate).not.toBe(dayAfterPaymentDate);
      expect(closeDayPaymentDate).toBe('2026-08-05');
      expect(dayAfterPaymentDate).toBe('2026-09-05');
    }
  );
});

