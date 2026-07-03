import { describe, it, expect } from 'vitest';
import {
  categoryActualsForCard,
  uncategorizedSpend,
  totalSpendForCard,
  envelopeRemaining,
  envelopeStatus,
  sumWarning,
  buildGrid,
  EnvTx,
} from '../envelopeHelpers';

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
  // Visa — July — income (must be excluded)
  tx(VISA, 200, '2026-07-01', CAT_GROCERY, 'income'),
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

  it('excludes income transactions', () => {
    const result = categoryActualsForCard(BASE_TXS, VISA, '2026-07');
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
// 3. Over/under status flips at the boundary
// ---------------------------------------------------------------------------

describe('envelopeStatus', () => {
  it('ok when actual is below sub-budget', () => {
    expect(envelopeStatus(300, 150)).toBe('ok');
  });

  it('ok when actual equals sub-budget exactly', () => {
    expect(envelopeStatus(300, 300)).toBe('ok');
  });

  it('over when actual exceeds sub-budget by even $0.01', () => {
    expect(envelopeStatus(300, 300.01)).toBe('over');
  });

  it('unset when sub-budget is zero', () => {
    expect(envelopeStatus(0, 0)).toBe('unset');
    expect(envelopeStatus(0, 50)).toBe('unset');
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
// 5. Grid cells equal the single-month computation for each month
// ---------------------------------------------------------------------------

describe('buildGrid', () => {
  const months = ['2026-07', '2026-08'];
  const cats = [
    { id: CAT_GROCERY, name: 'Groceries' },
    { id: CAT_REST,    name: 'Restaurants' },
  ];
  const goals = new Map<string, number | null>([
    ['2026-07', 2000],
    ['2026-08', null],
  ]);

  it('grid cell equals categoryActualsForCard for the same card+month', () => {
    const grid = buildGrid(BASE_TXS, VISA, cats, months, goals);

    const groceryRow = grid.rows.find((r) => r.categoryId === CAT_GROCERY)!;
    expect(groceryRow.actuals[0]).toBe(
      categoryActualsForCard(BASE_TXS, VISA, '2026-07').get(CAT_GROCERY) ?? 0
    );
    expect(groceryRow.actuals[1]).toBe(
      categoryActualsForCard(BASE_TXS, VISA, '2026-08').get(CAT_GROCERY) ?? 0
    );
  });

  it('totalActuals equal totalSpendForCard for each month', () => {
    const grid = buildGrid(BASE_TXS, VISA, cats, months, goals);
    expect(grid.totalActuals[0]).toBe(totalSpendForCard(BASE_TXS, VISA, '2026-07'));
    expect(grid.totalActuals[1]).toBe(totalSpendForCard(BASE_TXS, VISA, '2026-08'));
  });

  it('maps totalGoals per month', () => {
    const grid = buildGrid(BASE_TXS, VISA, cats, months, goals);
    expect(grid.totalGoals[0]).toBe(2000);
    expect(grid.totalGoals[1]).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 6. Uncategorized spend is surfaced, not dropped
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
// 7. Two cards with different goals/categories don't bleed into each other
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

  it('buildGrid with different envelopes per card produces independent rows', () => {
    const visaCats = [{ id: CAT_GROCERY, name: 'G' }, { id: CAT_REST, name: 'R' }];
    const mcCats   = [{ id: CAT_GROCERY, name: 'G' }, { id: CAT_SHOPPING, name: 'S' }];
    const goals    = new Map<string, number | null>();

    const visaGrid = buildGrid(BASE_TXS, VISA, visaCats, ['2026-07'], goals);
    const mcGrid   = buildGrid(BASE_TXS, MC,   mcCats,   ['2026-07'], goals);

    const visaGrocery = visaGrid.rows.find((r) => r.categoryId === CAT_GROCERY)!;
    const mcGrocery   = mcGrid.rows.find((r)   => r.categoryId === CAT_GROCERY)!;

    expect(visaGrocery.actuals[0]).toBe(150);
    expect(mcGrocery.actuals[0]).toBe(400);
  });
});
