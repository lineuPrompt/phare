import { describe, it, expect } from 'vitest';
import type { TimelineDay } from '@phare/core';
import { homeSnapshotPath, homeTimelinePath, loadHome } from '../lib/homeLoader';
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
    'totalIncome', 'totalExpenses', 'totalSavings', 'totalDebtPayments', 'totalBorrowed', 'netCashFlow',
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
        { cardId: 'v', cardName: 'Visa', basis: 'budget', amount: 900 },
        { cardId: 'm', cardName: 'Mastercard', basis: 'posted', amount: 0 },
      ],
      awaitingDates: false,
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
});
