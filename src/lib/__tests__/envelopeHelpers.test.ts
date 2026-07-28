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
import { statementCycleWindow, cycleMonthContaining } from '../dateHelpers';
import { netCycleSpend } from '../bridgeHelpers';

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

// All BASE_TXS fixtures below pass closeDay: null — statementCycleWindow's
// calendar-month fallback — so every pre-existing calendar-month assertion
// stays valid unchanged; these tests are about card isolation and month
// exclusion, not cycle-boundary behavior specifically (that's covered in its
// own describe block further down).

// ---------------------------------------------------------------------------
// 1. Per-category actuals match the ledger
// ---------------------------------------------------------------------------

describe('categoryActualsForCard', () => {
  it('sums categorized expenses for the target card and month only', () => {
    const result = categoryActualsForCard(BASE_TXS, VISA, '2026-07', null);
    expect(result.get(CAT_GROCERY)).toBe(150);   // 100 + 50
    expect(result.get(CAT_REST)).toBe(80);
    expect(result.has(CAT_SHOPPING)).toBe(false); // shopping was on MC
  });

  it('excludes bridge lines', () => {
    const result = categoryActualsForCard(BASE_TXS, VISA, '2026-07', null);
    // Bridge row adds 999 to Grocery — must not appear
    expect(result.get(CAT_GROCERY)).toBe(150);
  });

  it('excludes transactions outside the target month', () => {
    const result = categoryActualsForCard(BASE_TXS, VISA, '2026-07', null);
    // August Grocery on Visa is 60; should not appear in July result
    expect(result.get(CAT_GROCERY)).toBe(150);
    const aug = categoryActualsForCard(BASE_TXS, VISA, '2026-08', null);
    expect(aug.get(CAT_GROCERY)).toBe(60);
  });

  it('returns empty map for a month with no transactions', () => {
    const result = categoryActualsForCard(BASE_TXS, VISA, '2026-09', null);
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
    const result = categoryActualsForCard(REFUND_TXS, VISA, '2026-07', null);
    expect(result.get(CAT_GROCERY)).toBe(110); // 150 - 40
  });

  it('a refund reduces card total Spent', () => {
    expect(totalSpendForCard(REFUND_TXS, VISA, '2026-07', null)).toBe(110);
  });

  it('a refund exceeding spend goes negative honestly, not clamped to zero', () => {
    const bigRefund: EnvTx[] = [
      tx(VISA, 50,  '2026-07-05', CAT_GROCERY),
      tx(VISA, 200, '2026-07-10', CAT_GROCERY, 'income'),
    ];
    const result = categoryActualsForCard(bigRefund, VISA, '2026-07', null);
    expect(result.get(CAT_GROCERY)).toBe(-150);
    expect(totalSpendForCard(bigRefund, VISA, '2026-07', null)).toBe(-150);
  });

  it('a refund in a category with no other spend this month is still visible and netted', () => {
    const refundOnly: EnvTx[] = [tx(VISA, 25, '2026-07-10', CAT_SHOPPING, 'income')];
    const result = categoryActualsForCard(refundOnly, VISA, '2026-07', null);
    expect(result.has(CAT_SHOPPING)).toBe(true);
    expect(result.get(CAT_SHOPPING)).toBe(-25);
  });

  it('an uncategorized refund nets against uncategorized spend', () => {
    const uncatRefund: EnvTx[] = [
      tx(VISA, 100, '2026-07-05', null),
      tx(VISA, 30,  '2026-07-10', null, 'income'),
    ];
    expect(uncategorizedSpend(uncatRefund, VISA, '2026-07', null)).toBe(70);
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
    expect(sumWarning(items, 500)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. Carry-forward: nearest saved month at-or-before wins
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
// 6. Forward-looking grid: current cycle real, future budget-only
// ---------------------------------------------------------------------------

describe('buildGrid', () => {
  const months = ['2026-07', '2026-08'];
  const currentMonth = '2026-07';
  const today = '2026-07-15'; // safely mid-month for every closeDay:null fixture below
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
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth, null, today);
    const groceryRow = grid.rows.find((r) => r.categoryId === CAT_GROCERY)!;
    expect(groceryRow.actuals[0]).toBe(categoryActualsForCard(BASE_TXS, VISA, '2026-07', null).get(CAT_GROCERY));
  });

  it('future months are budget-only: actuals null even if transactions exist there', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth, null, today);
    const groceryRow = grid.rows.find((r) => r.categoryId === CAT_GROCERY)!;
    // BASE_TXS has a real August Grocery transaction (60), but August is future relative to today
    expect(groceryRow.actuals[1]).toBe(null);
    expect(grid.totalActuals[1]).toBe(null);
    expect(grid.uncategorizedActuals[1]).toBe(null);
  });

  it('budgets carry forward into months with no explicit save', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth, null, today);
    const groceryRow = grid.rows.find((r) => r.categoryId === CAT_GROCERY)!;
    expect(groceryRow.budgets[0]).toBe(200);
    expect(groceryRow.budgets[1]).toBe(200); // carried forward from July
  });

  it('totalGoals carry forward the same way', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth, null, today);
    expect(grid.totalGoals[0]).toBe(2000);
    expect(grid.totalGoals[1]).toBe(2000);
  });

  it('uncategorized spend is its own row-equivalent series, not a totals-only ghost', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth, null, today);
    expect(grid.uncategorizedActuals[0]).toBe(uncategorizedSpend(BASE_TXS, VISA, '2026-07', null));
  });

  it('a category with actual activity but no saved envelope item still appears as a row', () => {
    const refundOnly: EnvTx[] = [tx(VISA, 25, '2026-07-10', CAT_SHOPPING, 'income')];
    const grid = buildGrid(refundOnly, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth, null, today);
    const shoppingRow = grid.rows.find((r) => r.categoryId === CAT_SHOPPING);
    expect(shoppingRow).toBeDefined();
    expect(shoppingRow!.budgets[0]).toBe(0); // no envelope item, but visible and netted
    expect(shoppingRow!.actuals[0]).toBe(-25);
  });

  it('totalActuals equal totalSpendForCard for the current month', () => {
    const grid = buildGrid(BASE_TXS, VISA, itemSnapshots, categoryNames, months, goalsByMonth, currentMonth, null, today);
    expect(grid.totalActuals[0]).toBe(totalSpendForCard(BASE_TXS, VISA, '2026-07', null));
  });

  // -------------------------------------------------------------------------
  // Cycle-boundary correctness (2026-07-31) — the property the old
  // `month > currentMonth` isFuture check would have gotten wrong: a cycle
  // that has genuinely started accruing, but whose CLOSING month is still
  // "next month" by the calendar, must show real actuals, not a budget-only
  // placeholder — a live cycle with real money in it is not a future one.
  // -------------------------------------------------------------------------

  it('isFuture at a cycle spanning a calendar-month edge: the day AFTER close, the next-labeled cycle has already started', () => {
    // Card closes on the 27th. Viewed "today" is July 28 — one day into the
    // cycle that will close in August. Calendar-month-only logic (month >
    // currentMonth, currentMonth='2026-07') would wrongly call '2026-08'
    // future. Window-start logic correctly calls it current, because its
    // window (Jul28-Aug27) already started yesterday/today.
    const closeDay = 27;
    const todayAfterClose = '2026-07-28';
    const txns: EnvTx[] = [
      tx(VISA, 40, '2026-07-27', CAT_GROCERY), // last day of July's cycle
      tx(VISA, 15, '2026-07-28', CAT_GROCERY), // first day of August's cycle — real, live spend
    ];
    const grid = buildGrid(
      txns, VISA, new Map(), new Map([[CAT_GROCERY, 'Groceries']]),
      ['2026-07', '2026-08'], new Map(), '2026-07', closeDay, todayAfterClose
    );
    // July's cycle (Jun28-Jul27) is closed but still real, final data.
    expect(grid.totalActuals[0]).toBe(40);
    // August's cycle (Jul28-Aug27) has already started — must show its real,
    // still-growing $15, NOT null/budget-only.
    expect(grid.totalActuals[1]).not.toBeNull();
    expect(grid.totalActuals[1]).toBe(15);
  });

  it('isFuture correctly still treats a cycle that has NOT started yet as future', () => {
    const closeDay = 27;
    const today = '2026-07-15'; // well before July 28 — August's cycle has not begun
    const txns: EnvTx[] = [tx(VISA, 15, '2026-07-28', CAT_GROCERY)]; // won't exist yet in reality, but prove it's still hidden
    const grid = buildGrid(
      txns, VISA, new Map(), new Map([[CAT_GROCERY, 'Groceries']]),
      ['2026-07', '2026-08'], new Map(), '2026-07', closeDay, today
    );
    expect(grid.totalActuals[1]).toBeNull();
  });

  it('handles a December→January cycle-month rollover in the grid', () => {
    const closeDay = 15;
    const today = '2026-12-20';
    const txns: EnvTx[] = [
      tx(VISA, 100, '2026-12-10', CAT_GROCERY), // December's cycle (Nov16-Dec15) — wait, Dec 10 is BEFORE Dec 15 close, still Dec's cycle
      tx(VISA, 50, '2026-12-20', CAT_GROCERY),  // after Dec 15 close — January's cycle
    ];
    const grid = buildGrid(
      txns, VISA, new Map(), new Map([[CAT_GROCERY, 'Groceries']]),
      ['2026-12', '2027-01'], new Map(), '2026-12', closeDay, today
    );
    expect(grid.totalActuals[0]).toBe(100);
    expect(grid.totalActuals[1]).toBe(50); // January's cycle already open, real data, not future
  });
});

// ---------------------------------------------------------------------------
// 7. Uncategorized spend is surfaced, not dropped
// ---------------------------------------------------------------------------

describe('uncategorizedSpend', () => {
  it('returns sum of null-category expenses only', () => {
    expect(uncategorizedSpend(BASE_TXS, VISA, '2026-07', null)).toBe(30);
  });

  it('is excluded from categoryActualsForCard', () => {
    const actuals = categoryActualsForCard(BASE_TXS, VISA, '2026-07', null);
    expect(actuals.has(null as unknown as string)).toBe(false);
  });

  it('counts toward totalSpendForCard', () => {
    // Visa July: 100+50 (grocery) + 80 (rest) + 30 (uncategorized) = 260
    expect(totalSpendForCard(BASE_TXS, VISA, '2026-07', null)).toBe(260);
  });

  it('returns 0 when all transactions are categorized', () => {
    const clean = BASE_TXS.filter((t) => t.category_id !== null);
    expect(uncategorizedSpend(clean, VISA, '2026-07', null)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 8. Two cards with different goals/categories don't bleed into each other
// ---------------------------------------------------------------------------

describe('card isolation', () => {
  it('categoryActualsForCard on Visa does not include MC transactions', () => {
    const visaActuals = categoryActualsForCard(BASE_TXS, VISA, '2026-07', null);
    // MC has 400 in Grocery and 120 in Shopping; Visa Grocery is only 150
    expect(visaActuals.get(CAT_GROCERY)).toBe(150);
    expect(visaActuals.has(CAT_SHOPPING)).toBe(false);
  });

  it('categoryActualsForCard on MC does not include Visa transactions', () => {
    const mcActuals = categoryActualsForCard(BASE_TXS, MC, '2026-07', null);
    expect(mcActuals.get(CAT_GROCERY)).toBe(400);
    expect(mcActuals.get(CAT_SHOPPING)).toBe(120);
    expect(mcActuals.has(CAT_REST)).toBe(false); // Restaurants only on Visa
  });

  it('totalSpendForCard differs per card in the same month', () => {
    const visaTotal = totalSpendForCard(BASE_TXS, VISA, '2026-07', null);
    const mcTotal   = totalSpendForCard(BASE_TXS, MC,   '2026-07', null);
    expect(visaTotal).toBe(260);  // 150+80+30
    expect(mcTotal).toBe(520);    // 400+120
    expect(visaTotal).not.toBe(mcTotal);
  });
});

// ---------------------------------------------------------------------------
// 9. Statement-cycle display contract (2026-07-31) — supersedes the old
// calendar-month contract. An entry now belongs to whichever tab's cycle
// window actually contains its date; this is the whole point of the change
// (see envelopeHelpers.ts's rewritten DISPLAY CONTRACT docstring).
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

describe('groupEntriesByCategory — statement-cycle display contract', () => {
  it('groups entries by category, scoped to the cycle window (closeDay null = plain calendar month)', () => {
    const { byCategory, uncategorized } = groupEntriesByCategory(
      [
        cardTx('e1', 100, '2026-07-05', CAT_GROCERY),
        cardTx('e2', 50, '2026-07-20', CAT_REST),
        cardTx('e3', 30, '2026-07-18', null),
        cardTx('e4', 999, '2026-08-03', CAT_GROCERY), // different cycle — excluded
      ],
      VISA,
      '2026-07',
      null
    );
    expect(byCategory[CAT_GROCERY]?.map((e) => e.id)).toEqual(['e1']);
    expect(byCategory[CAT_REST]?.map((e) => e.id)).toEqual(['e2']);
    expect(uncategorized.map((e) => e.id)).toEqual(['e3']);
    expect(byCategory[CAT_GROCERY]?.some((e) => e.id === 'e4')).toBeFalsy();
  });

  it('excludes bridge rows even when dated within the viewed cycle', () => {
    const bridgeRow: CardTxRow = { id: 'b1', account_id: VISA, amount: 500, date: '2026-07-05', category_id: null, type: 'expense', is_bridge: true, description: 'Visa payment', installment_label: null };
    const { byCategory, uncategorized } = groupEntriesByCategory([bridgeRow], VISA, '2026-07', null);
    expect(Object.keys(byCategory)).toHaveLength(0);
    expect(uncategorized).toHaveLength(0);
  });

  it('an entry dated after the close day lands in the NEXT tab, not the current one', () => {
    const CLOSE_DAY = 15;
    const closeDayEntry = cardTx('close-day', 40, '2026-07-15', CAT_GROCERY); // on the close day
    const dayAfterEntry = cardTx('day-after', 60, '2026-07-16', CAT_GROCERY); // day after

    // July's tab (cycle closing July, closeDay 15): only the close-day entry.
    const july = groupEntriesByCategory([closeDayEntry, dayAfterEntry], VISA, '2026-07', CLOSE_DAY);
    expect(july.byCategory[CAT_GROCERY]?.map((e) => e.id)).toEqual(['close-day']);

    // August's tab: the day-after entry, not the close-day one.
    const august = groupEntriesByCategory([closeDayEntry, dayAfterEntry], VISA, '2026-08', CLOSE_DAY);
    expect(august.byCategory[CAT_GROCERY]?.map((e) => e.id)).toEqual(['day-after']);

    // Tab totals agree with the cycle each entry is genuinely in — no entry
    // is ever double-counted or dropped across adjacent tabs.
    expect(totalSpendForCard([closeDayEntry, dayAfterEntry], VISA, '2026-07', CLOSE_DAY)).toBe(40);
    expect(totalSpendForCard([closeDayEntry, dayAfterEntry], VISA, '2026-08', CLOSE_DAY)).toBe(60);
  });

  it('an entry dated exactly on the close day lands in the CURRENT cycle (inclusive boundary)', () => {
    const CLOSE_DAY = 27;
    const entry = cardTx('on-close', 100, '2026-07-27', CAT_GROCERY);
    const july = groupEntriesByCategory([entry], VISA, '2026-07', CLOSE_DAY);
    expect(july.byCategory[CAT_GROCERY]?.map((e) => e.id)).toEqual(['on-close']);
    const august = groupEntriesByCategory([entry], VISA, '2026-08', CLOSE_DAY);
    expect(august.byCategory[CAT_GROCERY] ?? []).toEqual([]);
  });

  it('closeDay null produces identical results to the old calendar-month behavior', () => {
    const entries = [
      cardTx('e1', 100, '2026-07-05', CAT_GROCERY),
      cardTx('e2', 999, '2026-08-03', CAT_GROCERY),
    ];
    const { byCategory } = groupEntriesByCategory(entries, VISA, '2026-07', null);
    expect(byCategory[CAT_GROCERY]?.map((e) => e.id)).toEqual(['e1']);
  });
});

// ---------------------------------------------------------------------------
// 10. The property that matters most: a closed cycle's tab total must equal
// the bridge payment amount that lands on Timeline for that same cycle.
// Both derivations use statementCycleWindow with the identical cycleMonth,
// and both net via signedAmount — same window, same rule, so they cannot
// diverge, including in the presence of a refund.
// ---------------------------------------------------------------------------

describe('closed-cycle tab total === Timeline bridge payment amount', () => {
  const CLOSE_DAY = 27;
  const CYCLE_MONTH = '2026-07'; // window Jun28-Jul27 — this is bridgeHelpers' own "spendMonth"

  it('a plain closed cycle: envelope total matches netCycleSpend exactly', () => {
    const txns: EnvTx[] = [
      tx(VISA, 418.94, '2026-07-01', CAT_GROCERY),
      tx(VISA, 220.50, '2026-06-30', null), // in-window tail from the prior calendar month
      tx(VISA, 75.00,  '2026-07-27', CAT_GROCERY), // on the close day
    ];
    const window = statementCycleWindow(CYCLE_MONTH, CLOSE_DAY);
    const envelopeTotal = totalSpendForCard(txns, VISA, CYCLE_MONTH, CLOSE_DAY);
    const bridgeAmount = netCycleSpend(
      txns.map((t) => ({ date: t.date, type: t.type, amount: Number(t.amount) })),
      window
    );
    expect(envelopeTotal).toBe(bridgeAmount);
    expect(envelopeTotal).toBe(714.44);
  });

  it('a refund in the cycle nets identically on both sides — cannot make them diverge', () => {
    const txns: EnvTx[] = [
      tx(VISA, 300, '2026-07-10', CAT_SHOPPING),
      tx(VISA, 45,  '2026-07-12', CAT_SHOPPING, 'income'), // partial refund
    ];
    const window = statementCycleWindow(CYCLE_MONTH, CLOSE_DAY);
    const envelopeTotal = totalSpendForCard(txns, VISA, CYCLE_MONTH, CLOSE_DAY);
    const bridgeAmount = netCycleSpend(
      txns.map((t) => ({ date: t.date, type: t.type, amount: Number(t.amount) })),
      window
    );
    expect(envelopeTotal).toBe(bridgeAmount);
    expect(envelopeTotal).toBe(255);
  });

  it('a post-close entry (belongs to the NEXT cycle) affects neither this cycle\'s envelope nor this cycle\'s bridge', () => {
    const inCycle = tx(VISA, 100, '2026-07-20', CAT_GROCERY);
    const nextCycle = tx(VISA, 999, '2026-07-28', CAT_GROCERY); // after the close day
    const txns = [inCycle, nextCycle];
    const window = statementCycleWindow(CYCLE_MONTH, CLOSE_DAY);
    const envelopeTotal = totalSpendForCard(txns, VISA, CYCLE_MONTH, CLOSE_DAY);
    const bridgeAmount = netCycleSpend(
      txns.map((t) => ({ date: t.date, type: t.type, amount: Number(t.amount) })),
      window
    );
    expect(envelopeTotal).toBe(100);
    expect(bridgeAmount).toBe(100);
    expect(envelopeTotal).toBe(bridgeAmount);
  });
});

// ---------------------------------------------------------------------------
// 11. cycleMonthContaining resolves the same window the Cards page shows for
// the live cycle — the coaching layer's anchor and the Cards page's own
// current-tab must always agree on which window is "live right now," even
// though they get there via different lookups.
// ---------------------------------------------------------------------------

describe('coaching-layer anchor agrees with the Cards page\'s live cycle', () => {
  it('cycleMonthContaining picks the same cycleMonth a family would see under the "current" tab', () => {
    const closeDay = 27;
    const today = '2026-07-15';
    const liveCycleMonth = cycleMonthContaining(today, closeDay);
    // The Cards page's own "current" tab, absent explicit navigation, is
    // whichever tab's window contains today — same resolution, same answer.
    const window = statementCycleWindow(liveCycleMonth, closeDay);
    expect(today >= window.start && today <= window.end).toBe(true);
    expect(liveCycleMonth).toBe('2026-07');
  });

  it('after the close day, both resolve to the NEXT cycle month, not the one that just closed', () => {
    const closeDay = 27;
    const today = '2026-07-28';
    const liveCycleMonth = cycleMonthContaining(today, closeDay);
    expect(liveCycleMonth).toBe('2026-08');
    const window = statementCycleWindow(liveCycleMonth, closeDay);
    expect(today >= window.start && today <= window.end).toBe(true);
  });
});
