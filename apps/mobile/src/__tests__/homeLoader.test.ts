import { describe, it, expect } from 'vitest';
import type { TimelineDay } from '@phare/core';
import { homeMonths, homeSnapshotPath, homeTimelinePath, loadHome, loadHomeMonth } from '../lib/homeLoader';
import type { Getter } from '../lib/timelineLoader';

/** A getter answering from a table; an Error value is thrown. Records every path asked for. */
function recorder(table: Record<string, unknown>) {
  const asked: string[] = [];
  const get = (async (path: string) => {
    asked.push(path);
    if (!(path in table)) throw new Error(`unexpected request: ${path}`);
    const value = table[path];
    if (value instanceof Error) throw value;
    return value;
  }) as Getter;
  return { get, asked };
}

// 02:30 UTC on 1 October is still 30 September, 22:30, in Toronto.
const LATE_SEPT_TORONTO = () => new Date('2026-10-01T02:30:00Z');
const MID_OCT = () => new Date('2026-10-09T16:00:00Z');

const ACCOUNTS = { accounts: [{ id: 'chq', name: 'Chequing', type: 'chequing' }, { id: 'v', name: 'Visa', type: 'credit_card' }] };
const ZONE = { timezone: 'America/Toronto' };

// Every figure distinct, so a swapped field cannot pass.
const SUMMARY = {
  totalIncome: 5210.11,
  totalExpenses: 3120.22,
  totalSavings: 640.33,
  totalDebtPayments: 150.44,
  totalBorrowed: 75.55,
  totalWithdrawn: 33.66,
  netCashFlow: 1299.12,
  savingsByDestination: [
    { accountId: 'a1', name: 'Travel', amount: 400.33 },
    { accountId: null, name: null, amount: 240 },
  ],
};

const dashboard = (over: Record<string, unknown> = {}) => ({
  hasPlan: true,
  month: '2026-10-01',
  summary: SUMMARY,
  unanchoredIncomeCount: 0,
  unanchoredExpenseCount: 0,
  earliestAnchorMonth: '2026-07',
  ...over,
});

const day = (date: string, endOfDayBalance: number): TimelineDay => ({
  date, entries: [], endOfDayBalance, isNegative: endOfDayBalance < 0,
});

const PLAN_MONTH = {
  month: '2026-10',
  isPartialMonth: true,
  balance: 2811.07,
  cardCost: [
    { cardId: 'v', cardName: 'Visa', basis: 'budget', amount: 900 },
    { cardId: 'm', cardName: 'Mastercard', basis: 'posted', amount: 0 },
  ],
  cardCostTotal: 900,
  unanchoredIncomeCount: 0,
  unanchoredExpenseCount: 0,
};

const timeline = (over: Record<string, unknown> = {}) => ({
  ok: true,
  balancesStartDate: '2026-09-01',
  openingBalance: 1000,
  closingBalance: 4100.9,
  todayBalance: 3900,
  days: [day('2026-09-29', 3050.25), day('2026-09-30', 3333.33), day('2026-10-01', 3500), day('2026-10-31', 4100.9), day('2026-11-01', 9999)],
  dip: null,
  nextIncomeDate: null,
  unbalancedDays: [],
  plan: { months: [PLAN_MONTH, { ...PLAN_MONTH, month: '2026-11', isPartialMonth: false, balance: 1 }] },
  ...over,
});

function table(over: Record<string, unknown> = {}) {
  return {
    '/api/accounts': ACCOUNTS,
    '/api/household/timezone': ZONE,
    [homeSnapshotPath('2026-10')]: dashboard(),
    [homeTimelinePath('chq')]: timeline(),
    ...over,
  };
}

describe('loadHome: what it asks for', () => {
  it('asks for the snapshot only and the plan, and never marks a timeline page view', async () => {
    const r = recorder(table());
    await loadHome(r.get, MID_OCT);
    expect(r.asked).toEqual([
      '/api/accounts',
      '/api/household/timezone',
      '/api/dashboard?month=2026-10&snapshotOnly=1',
      '/api/timeline?account=chq&includePlan=1',
    ]);
  });

  it('asks for the household’s month, not the UTC one', async () => {
    const r = recorder(table({
      [homeSnapshotPath('2026-09')]: dashboard({ month: '2026-09-01' }),
    }));
    const load = await loadHome(r.get, LATE_SEPT_TORONTO);
    expect(load.month).toBe('2026-09');
    expect(r.asked).toContain('/api/dashboard?month=2026-09&snapshotOnly=1');
  });

  it('propagates a failed timezone read instead of guessing a zone', async () => {
    const r = recorder(table({ '/api/household/timezone': new Error('zone down') }));
    await expect(loadHome(r.get, MID_OCT)).rejects.toThrow('zone down');
  });
});

describe('loadHome: the snapshot is the server’s figures, to the cent', () => {
  it('carries each summary figure to its own field', async () => {
    const { snapshot } = await loadHome(recorder(table()).get, MID_OCT);
    expect(snapshot).toEqual({
      income: 5210.11,
      expenses: 3120.22,
      savings: 640.33,
      savingsLines: [
        { key: 'a1', name: 'Travel', amount: 400.33 },
        { key: '__other__', name: null, amount: 240 },
      ],
      debtPayments: 150.44,
      netCashFlow: 1299.12,
      borrowed: 75.55,
      withdrawn: 33.66,
      awaitingDates: false,
    });
  });

  it.each([
    ['unanchoredIncomeCount', { unanchoredIncomeCount: 1 }],
    ['unanchoredExpenseCount', { unanchoredExpenseCount: 2 }],
  ])('flags lines awaiting a date from %s', async (_name, over) => {
    const r = recorder(table({ [homeSnapshotPath('2026-10')]: dashboard(over) }));
    expect((await loadHome(r.get, MID_OCT)).snapshot.awaitingDates).toBe(true);
  });

  it('refuses figures the route computed for another month', async () => {
    const r = recorder(table({ [homeSnapshotPath('2026-10')]: dashboard({ month: '2026-09-01' }) }));
    await expect(loadHome(r.get, MID_OCT)).rejects.toThrow('answered for 2026-09-01, asked for 2026-10');
  });

  it('refuses a household the dashboard says has no plan', async () => {
    const r = recorder(table({ [homeSnapshotPath('2026-10')]: { hasPlan: false } }));
    await expect(loadHome(r.get, MID_OCT)).rejects.toThrow('without a plan');
  });

  it.each([
    'totalIncome', 'totalExpenses', 'totalSavings', 'totalDebtPayments', 'totalBorrowed', 'totalWithdrawn', 'netCashFlow',
  ])('throws when %s is missing, rather than showing zero', async (field) => {
    const summary: Record<string, unknown> = { ...SUMMARY };
    delete summary[field];
    const r = recorder(table({ [homeSnapshotPath('2026-10')]: dashboard({ summary }) }));
    await expect(loadHome(r.get, MID_OCT)).rejects.toThrow(`${field} is not a number`);
  });

  it('throws on a figure sent as text', async () => {
    const r = recorder(table({
      [homeSnapshotPath('2026-10')]: dashboard({ summary: { ...SUMMARY, netCashFlow: '1299.12' } }),
    }));
    await expect(loadHome(r.get, MID_OCT)).rejects.toThrow('netCashFlow is not a number');
  });
});

describe('loadHome: the plan card', () => {
  it('reads the current month’s chain entry and the month’s real balances', async () => {
    const { plan } = await loadHome(recorder(table()).get, MID_OCT);
    expect(plan).toEqual({
      kind: 'ready',
      // buildMonthView: last October day, and the day before October's first.
      realClose: 4100.9,
      carriedIn: 3333.33,
      balance: 2811.07,
      isPartialMonth: true,
      cards: [
        // The fixture has no inProgress (a server from before 2026-11-13): false.
        { cardId: 'v', cardName: 'Visa', basis: 'budget', amount: 900, inProgress: false },
        { cardId: 'm', cardName: 'Mastercard', basis: 'posted', amount: 0, inProgress: false },
      ],
      awaitingDates: false,
      // The month-end path: every month the chain sent. No statement history
      // in this fixture (a server from before 2026-11-14): none shown.
      path: [{ month: '2026-10', balance: 2811.07 }, { month: '2026-11', balance: 1 }],
      statements: [],
    });
  });

  it('flags plan lines awaiting a date', async () => {
    const r = recorder(table({
      [homeTimelinePath('chq')]: timeline({ plan: { months: [{ ...PLAN_MONTH, unanchoredExpenseCount: 1 }] } }),
    }));
    const { plan } = await loadHome(r.get, MID_OCT);
    expect(plan.kind === 'ready' && plan.awaitingDates).toBe(true);
  });

  it('shows no plan when the route sent none, and still shows the snapshot', async () => {
    const r = recorder(table({ [homeTimelinePath('chq')]: timeline({ plan: null }) }));
    const load = await loadHome(r.get, MID_OCT);
    expect(load.plan).toEqual({ kind: 'hidden' });
    expect(load.snapshot.income).toBe(5210.11);
  });

  it('shows no plan when the chain has no entry for this month', async () => {
    const r = recorder(table({
      [homeTimelinePath('chq')]: timeline({ plan: { months: [{ ...PLAN_MONTH, month: '2026-11' }] } }),
    }));
    expect((await loadHome(r.get, MID_OCT)).plan).toEqual({ kind: 'hidden' });
  });

  it('asks for a real balance when none is anchored', async () => {
    const r = recorder(table({ [homeTimelinePath('chq')]: { ok: false, reason: 'no_anchor' } }));
    expect((await loadHome(r.get, MID_OCT)).plan).toEqual({ kind: 'noAnchor' });
  });

  it('never requests a timeline for a household with no chequing account', async () => {
    const r = recorder(table({ '/api/accounts': { accounts: [{ id: 'v', name: 'Visa', type: 'credit_card' }] } }));
    const load = await loadHome(r.get, MID_OCT);
    expect(load.plan).toEqual({ kind: 'noAnchor' });
    expect(r.asked.some((path) => path.startsWith('/api/timeline'))).toBe(false);
  });

  it('throws on a plan balance that is not a number', async () => {
    const r = recorder(table({
      [homeTimelinePath('chq')]: timeline({ plan: { months: [{ ...PLAN_MONTH, balance: null }] } }),
    }));
    await expect(loadHome(r.get, MID_OCT)).rejects.toThrow('plan balance is not a number');
  });

  it('throws on a card basis it does not know, rather than mislabelling the line', async () => {
    const r = recorder(table({
      [homeTimelinePath('chq')]: timeline({
        plan: { months: [{ ...PLAN_MONTH, cardCost: [{ cardId: 'v', cardName: 'Visa', basis: 'forecast', amount: 1 }] }] },
      }),
    }));
    await expect(loadHome(r.get, MID_OCT)).rejects.toThrow('unknown card basis "forecast"');
  });

  it('a statement still running comes through flagged, for the "statement still open" line', async () => {
    const r = recorder(table({
      [homeTimelinePath('chq')]: timeline({
        plan: {
          months: [{
            ...PLAN_MONTH,
            cardCost: [
              { cardId: 'v', cardName: 'Visa', basis: 'actual', amount: 1750.69, inProgress: true },
              { cardId: 'm', cardName: 'Mastercard', basis: 'actual', amount: 80, inProgress: false },
            ],
          }],
        },
      }),
    }));
    const { plan } = await loadHome(r.get, MID_OCT);
    expect(plan.kind === 'ready' ? plan.cards.map((c) => [c.cardName, c.inProgress]) : null).toEqual([
      ['Visa', true],
      ['Mastercard', false],
    ]);
  });

  it('throws on an inProgress that is not a boolean, rather than guess', async () => {
    const r = recorder(table({
      [homeTimelinePath('chq')]: timeline({
        plan: { months: [{ ...PLAN_MONTH, cardCost: [{ cardId: 'v', cardName: 'Visa', basis: 'actual', amount: 1, inProgress: 'yes' }] }] },
      }),
    }));
    await expect(loadHome(r.get, MID_OCT)).rejects.toThrow('card inProgress is not a boolean');
  });
});

// ---------------------------------------------------------------------------
// Month navigation (2026-10-15): the web dashboard's range and past-month state.
// ---------------------------------------------------------------------------

describe('homeMonths: the range Home pages through', () => {
  it('runs from the earliest anchor month to the current month + 11', () => {
    const months = homeMonths('2026-10', '2026-07', null);
    expect(months[0]).toBe('2026-07');
    expect(months[months.length - 1]).toBe('2027-09');
    expect(months).toHaveLength(15);
  });

  it('with no anchor, the current month is the floor', () => {
    expect(homeMonths('2026-10', null, '2026-12')).toEqual(['2026-10', '2026-11', '2026-12']);
  });

  it('an anchor after today does not move the floor past the current month', () => {
    expect(homeMonths('2026-10', '2026-11', '2026-11')).toEqual(['2026-10', '2026-11']);
  });

  it('stops at the entitled horizon when it ends before current + 11', () => {
    expect(homeMonths('2026-10', '2026-09', '2026-12')).toEqual(['2026-09', '2026-10', '2026-11', '2026-12']);
  });

  it('never goes past current + 11, even if a horizon claims more', () => {
    const months = homeMonths('2026-10', null, '2028-01');
    expect(months[months.length - 1]).toBe('2027-09');
  });
});

describe('loadHome: the paging context', () => {
  it('takes the floor from the dashboard and the cap from the timeline', async () => {
    const r = recorder(table({
      [homeSnapshotPath('2026-10')]: dashboard({ earliestAnchorMonth: '2026-08' }),
      [homeTimelinePath('chq')]: timeline({ horizonEndMonth: '2026-12' }),
    }));
    const load = await loadHome(r.get, MID_OCT);
    expect(load.context.months).toEqual(['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']);
    expect(load.context.currentMonth).toBe('2026-10');
  });

  it('refuses an earliestAnchorMonth that is not a month, rather than moving the floor', async () => {
    const r = recorder(table({ [homeSnapshotPath('2026-10')]: dashboard({ earliestAnchorMonth: '2026-8' }) }));
    await expect(loadHome(r.get, MID_OCT)).rejects.toThrow('earliestAnchorMonth is not a month');
  });

  it('a refresh lands on the month being viewed', async () => {
    const r = recorder(table({
      [homeSnapshotPath('2026-08')]: dashboard({ month: '2026-08-01' }),
    }));
    const load = await loadHome(r.get, MID_OCT, '2026-08');
    expect(load.month).toBe('2026-08');
    expect(load.plan).toEqual({ kind: 'past' });
  });

  it('a refresh on a month no longer reachable falls back to the current month', async () => {
    const r = recorder(table());
    const load = await loadHome(r.get, MID_OCT, '2025-01');
    expect(load.month).toBe('2026-10');
    expect(r.asked).not.toContain(homeSnapshotPath('2025-01'));
  });
});

describe('loadHomeMonth: one month over the loaded context', () => {
  async function context() {
    return (await loadHome(recorder(table()).get, MID_OCT)).context;
  }

  it("a past month: its own actuals, the plan's 'already happened' state, and no timeline request", async () => {
    const ctx = await context();
    const r = recorder({ [homeSnapshotPath('2026-08')]: dashboard({ month: '2026-08-01' }) });
    const month = await loadHomeMonth(r.get, ctx, '2026-08');
    expect(r.asked).toEqual(['/api/dashboard?month=2026-08&snapshotOnly=1']);
    expect(month).toMatchObject({ month: '2026-08', isPastMonth: true, plan: { kind: 'past' } });
    expect(month.snapshot.netCashFlow).toBe(SUMMARY.netCashFlow);
  });

  it("a later month: that month's chain entry, not the current one's", async () => {
    const ctx = await context();
    const r = recorder({ [homeSnapshotPath('2026-11')]: dashboard({ month: '2026-11-01' }) });
    const month = await loadHomeMonth(r.get, ctx, '2026-11');
    expect(month.isPastMonth).toBe(false);
    expect(month.plan).toMatchObject({ kind: 'ready', balance: 1, isPartialMonth: false });
  });

  it('refuses a snapshot computed for another month', async () => {
    const ctx = await context();
    const r = recorder({ [homeSnapshotPath('2026-11')]: dashboard({ month: '2026-10-01' }) });
    await expect(loadHomeMonth(r.get, ctx, '2026-11')).rejects.toThrow('asked for 2026-11');
  });
});

// ── A future month: one sum, its why, the path and the statement check ─────
// (2026-11-14). Figures: household 2be22642's May 2027, as the live chain
// computed them (read-only), placed one month after the fixture's October.

describe('loadHome: a future month reads the plan sum, never adds it up', () => {
  const LINES = { income: 11115, bills: 7123.33, savings: 1489.52, debtPayments: 0, drawn: 0, leftAfterBillsAndSavings: 2502.15, cards: 4550 };
  const FUTURE = {
    month: '2026-11', isPartialMonth: false, balance: -637.84, startBalance: 1410.01,
    cardCost: [
      { cardId: 'v', cardName: 'Visa Avion', basis: 'budget', amount: 2550, budget: 2550, inProgress: false },
      { cardId: 'c', cardName: 'Costco Julia', basis: 'actual', amount: 2000, budget: null, inProgress: true },
    ],
    unanchoredIncomeCount: 0, unanchoredExpenseCount: 0,
    breakdown: { status: 'ok', lines: LINES },
    why: { kind: 'extraPayments', items: [{ name: 'Mortgage / Hypothèque', occurrences: 3, usualOccurrences: 2, dates: ['2027-05-03', '2027-05-17', '2027-05-31'] }] },
  };
  const HISTORY = [
    { cardId: 'v', cardName: 'Visa Avion', count: 4, low: 4049.28, high: 5696.18, statements: [] },
    { cardId: 'c', cardName: 'Costco Julia', count: 3, low: 443.19, high: 1933.12, statements: [] },
  ];

  async function future(planMonth: Record<string, unknown>, history: unknown[] = HISTORY) {
    const r = recorder(table({
      [homeTimelinePath('chq')]: timeline({ plan: { months: [{ ...PLAN_MONTH, startBalance: 3900, breakdown: { status: 'ok', lines: LINES }, why: null }, planMonth], statementHistory: history } }),
      [homeSnapshotPath('2026-11')]: dashboard({ month: '2026-11-01' }),
    }));
    const load = await loadHome(r.get, MID_OCT);
    return loadHomeMonth(r.get, load.context, '2026-11');
  }

  it('carries every line, card, reason, path point and statement to the cent', async () => {
    const { plan } = await future(FUTURE);
    expect(plan).toEqual({
      kind: 'future',
      startBalance: 1410.01,
      lines: { income: 11115, bills: 7123.33, savings: 1489.52, debtPayments: 0, drawn: 0 },
      balance: -637.84,
      cards: [
        { cardId: 'v', cardName: 'Visa Avion', basis: 'budget', amount: 2550, inProgress: false },
        { cardId: 'c', cardName: 'Costco Julia', basis: 'actual', amount: 2000, inProgress: true },
      ],
      why: { kind: 'extraPayments', items: [{ name: 'Mortgage / Hypothèque', occurrences: 3, dates: ['2027-05-03', '2027-05-17', '2027-05-31'] }] },
      awaitingDates: false,
      path: [{ month: '2026-10', balance: 2811.07 }, { month: '2026-11', balance: -637.84 }],
      // Budget joined from THIS month's card line, by id — null stays null.
      statements: [
        { cardId: 'v', cardName: 'Visa Avion', budget: 2550, count: 4, low: 4049.28, high: 5696.18 },
        { cardId: 'c', cardName: 'Costco Julia', budget: null, count: 3, low: 443.19, high: 1933.12 },
      ],
    });
  });

  it('every line lands in its own field — each one distinct, so a swap cannot pass', async () => {
    const lines = { income: 1.11, bills: 2.22, savings: 3.33, debtPayments: 4.44, drawn: 5.55, leftAfterBillsAndSavings: 9.99, cards: 6.66 };
    const { plan } = await future({ ...FUTURE, breakdown: { status: 'ok', lines } });
    expect(plan).toMatchObject({ kind: 'future', lines: { income: 1.11, bills: 2.22, savings: 3.33, debtPayments: 4.44, drawn: 5.55 } });
  });

  it('each other reason arrives as sent', async () => {
    for (const why of [
      { kind: 'cardsOverLeft', cards: 4550, left: 4002.15 },
      { kind: 'startsBelowZero', startBalance: -542.28, isPartialMonth: false },
      { kind: 'moreOutThanIn', amount: 120 },
    ]) {
      expect((await future({ ...FUTURE, why })).plan).toMatchObject({ kind: 'future', why });
    }
    expect((await future({ ...FUTURE, why: null })).plan).toMatchObject({ kind: 'future', why: null });
  });

  it('a breakdown the server could not build: no lines and no reason, only the message', async () => {
    const { plan } = await future({ ...FUTURE, breakdown: { status: 'error' } });
    expect(plan).toMatchObject({ kind: 'future', lines: null, why: null });
  });

  it('the current month keeps the older layout even when the server sends a breakdown', async () => {
    const r = recorder(table({
      [homeTimelinePath('chq')]: timeline({ plan: { months: [{
        ...PLAN_MONTH, startBalance: 3900, breakdown: { status: 'ok', lines: LINES }, why: null,
        cardCost: [{ cardId: 'v', cardName: 'Visa', basis: 'budget', amount: 900, budget: 900 }],
      }], statementHistory: HISTORY } }),
    }));
    const { plan } = await loadHome(r.get, MID_OCT);
    expect(plan.kind).toBe('ready');
    expect(plan).toMatchObject({ statements: [{ cardId: 'v', budget: 900 }, { cardId: 'c', budget: null }] });
  });

  it('a server from before 2026-11-14 (no breakdown) keeps the older layout for a future month', async () => {
    const { breakdown: _b, startBalance: _s, why: _w, ...older } = FUTURE;
    void _b; void _s; void _w;
    const { plan } = await future(older, []);
    expect(plan.kind).toBe('ready');
  });

  it('refuses a payload it cannot trust, rather than drawing it', async () => {
    await expect(future({ ...FUTURE, startBalance: '1410.01' })).rejects.toThrow('plan startBalance is not a number');
    await expect(future({ ...FUTURE, breakdown: { status: 'ok', lines: { ...LINES, bills: null } } })).rejects.toThrow('lines bills is not a number');
    await expect(future({ ...FUTURE, breakdown: { status: 'maybe' } })).rejects.toThrow('unknown breakdown');
    await expect(future({ ...FUTURE, why: { kind: 'vibes' } })).rejects.toThrow('unknown why');
    await expect(future({ ...FUTURE, why: { ...FUTURE.why, items: [{ ...FUTURE.why.items[0], dates: ['May 3'] }] } })).rejects.toThrow('why dates are not dates');
    await expect(future(FUTURE, [{ ...HISTORY[0], low: undefined }])).rejects.toThrow('statement low is not a number');
  });
});
