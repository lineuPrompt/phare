import { describe, it, expect } from 'vitest';
import { buildCashTimeline, TimelineAnchor, TimelineTx } from '../timelineHelpers';
import { buildMonthView, availableMonths, groupUnbalancedTransactions } from '../timelineDisplayHelpers';

// ── Factories (mirrors timelineHelpers.test.ts) ─────────────────────────────

let _id = 0;
function tx(
  overrides: Partial<TimelineTx> & { date: string; amount: number; type: 'income' | 'expense' | 'transfer' }
): TimelineTx {
  return {
    id: `tx-${++_id}`,
    description: null,
    recurringItemId: null,
    recurrenceId: null,
    installmentLabel: null,
    transferPeerId: null,
    isBridge: false,
    bridgeSourceAccount: null,
    bridgeSourceMonth: null,
    ...overrides,
  };
}

function anchor(date: string, balance: number): TimelineAnchor {
  return { date, balance };
}

// ── groupUnbalancedTransactions ──────────────────────────────────────────────

describe('groupUnbalancedTransactions', () => {
  it('keeps only transactions in [rangeStart, rangeEndExclusive)', () => {
    const txs = [
      tx({ date: '2026-06-30', amount: 10, type: 'income' }), // before range
      tx({ date: '2026-07-01', amount: 20, type: 'expense' }),
      tx({ date: '2026-07-14', amount: 30, type: 'income' }),
      tx({ date: '2026-07-15', amount: 40, type: 'expense' }), // rangeEnd itself, excluded
    ];
    const days = groupUnbalancedTransactions(txs, '2026-07-01', '2026-07-15');
    expect(days.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-14']);
  });

  it('groups same-day entries and sorts income before expense/transfer, chronological across days', () => {
    const txs = [
      tx({ date: '2026-07-03', amount: 5, type: 'expense', id: 'e1' }),
      tx({ date: '2026-07-01', amount: 100, type: 'expense', id: 'e2' }),
      tx({ date: '2026-07-01', amount: 200, type: 'income', id: 'i1' }),
    ];
    const days = groupUnbalancedTransactions(txs, '2026-07-01', '2026-07-10');
    expect(days.map((d) => d.date)).toEqual(['2026-07-01', '2026-07-03']);
    expect(days[0].entries.map((e) => e.type)).toEqual(['income', 'expense']);
  });

  it('returns [] when nothing falls in range', () => {
    const txs = [tx({ date: '2026-08-01', amount: 5, type: 'income' })];
    expect(groupUnbalancedTransactions(txs, '2026-07-01', '2026-07-15')).toEqual([]);
  });
});

// ── availableMonths ───────────────────────────────────────────────────────────

describe('availableMonths', () => {
  it('lists every month from balancesStartDate through windowEnd, inclusive', () => {
    expect(availableMonths('2026-07-05', '2026-09-30')).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('handles a single-month range', () => {
    expect(availableMonths('2026-07-01', '2026-07-31')).toEqual(['2026-07']);
  });

  it('crosses a year boundary', () => {
    expect(availableMonths('2026-11-01', '2027-02-28')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
});

// ── buildMonthView ────────────────────────────────────────────────────────────

describe('buildMonthView', () => {
  it('returns null for a month outside the result window', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 1000)],
      transactions: [],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-31',
      today: '2026-07-10',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(buildMonthView(result.days, [], result.openingBalance, result.balancesStartDate, '2026-08')).toBeNull();
  });

  it('opensAt uses openingBalance for the very first month, closesAt is the last day of the month', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 1000)],
      transactions: [
        tx({ date: '2026-07-05', amount: 100, type: 'expense' }),
        tx({ date: '2026-07-31', amount: 50, type: 'income' }),
      ],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-31',
      today: '2026-07-10',
    });
    if (!result.ok) throw new Error('expected ok');
    const view = buildMonthView(result.days, [], result.openingBalance, result.balancesStartDate, '2026-07');
    expect(view).not.toBeNull();
    expect(view!.opensAt).toBe(1000);
    expect(view!.closesAt).toBe(950); // 1000 - 100 + 50
    expect(view!.visibleDays.map((d) => d.date)).toEqual(['2026-07-05', '2026-07-31']);
    expect(view!.balancesBeginNote).toBe(false);
  });

  it('opensAt for a later month carries the previous day end-of-day balance, not openingBalance', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-01', 1000)],
      transactions: [tx({ date: '2026-07-31', amount: 200, type: 'expense' })],
      windowStart: '2026-07-01',
      windowEnd: '2026-08-31',
      today: '2026-07-10',
    });
    if (!result.ok) throw new Error('expected ok');
    const augView = buildMonthView(result.days, [], result.openingBalance, result.balancesStartDate, '2026-08');
    expect(augView).not.toBeNull();
    expect(augView!.opensAt).toBe(800); // carried from July 31 close
    expect(augView!.closesAt).toBe(800); // no August entries
    expect(augView!.visibleDays).toEqual([]);
  });

  it('flags balancesBeginNote only when the anchor lands mid-month, and attaches that month\'s unbalanced days', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-15', 500)],
      transactions: [tx({ date: '2026-07-20', amount: 10, type: 'income' })],
      windowStart: '2026-07-01',
      windowEnd: '2026-07-31',
      today: '2026-07-20',
    });
    if (!result.ok) throw new Error('expected ok');
    expect(result.balancesStartDate).toBe('2026-07-15');

    const preAnchorTxs = [
      tx({ date: '2026-07-03', amount: 75, type: 'income' }),
      tx({ date: '2026-07-10', amount: 20, type: 'expense' }),
    ];
    const unbalanced = groupUnbalancedTransactions(preAnchorTxs, '2026-07-01', result.balancesStartDate);

    const view = buildMonthView(result.days, unbalanced, result.openingBalance, result.balancesStartDate, '2026-07');
    expect(view).not.toBeNull();
    expect(view!.balancesBeginNote).toBe(true);
    expect(view!.unbalancedDays.map((d) => d.date)).toEqual(['2026-07-03', '2026-07-10']);
    expect(view!.opensAt).toBe(500); // first month: openingBalance, not a fabricated pre-anchor walk-up
  });

  it('unbalancedDays outside the requested month are excluded', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-07-15', 500), anchor('2026-08-01', 900)],
      transactions: [],
      windowStart: '2026-07-01',
      windowEnd: '2026-08-31',
      today: '2026-07-20',
    });
    if (!result.ok) throw new Error('expected ok');
    const unbalanced = groupUnbalancedTransactions(
      [tx({ date: '2026-07-03', amount: 75, type: 'income' })],
      '2026-07-01',
      result.balancesStartDate
    );
    const augView = buildMonthView(result.days, unbalanced, result.openingBalance, result.balancesStartDate, '2026-08');
    expect(augView!.unbalancedDays).toEqual([]);
  });
});

// ── MonthView.lowest — the month's own low (2026-09-03) ─────────────────────
// A DIFFERENT figure from TimelineHeader's dip: month-scoped, recomputed on
// every navigation, and not stopped by the next payday. The Timeline banner
// under-reported September because it showed the pre-payday dip ($1,560.50 on
// Sep 7) while the month's actual low was $236.85 on Sep 21.
describe('buildMonthView — lowest', () => {
  it('finds the minimum end-of-day balance in the month', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-09-01', 1000)],
      transactions: [
        tx({ date: '2026-09-05', amount: 700, type: 'expense' }),   // 300
        tx({ date: '2026-09-10', amount: 900, type: 'income' }),    // 1200
        tx({ date: '2026-09-20', amount: 1100, type: 'expense' }),  // 100  <- low
        tx({ date: '2026-09-25', amount: 500, type: 'income' }),    // 600
      ],
      windowStart: '2026-09-01', windowEnd: '2026-09-30', today: '2026-09-01',
    });
    const view = buildMonthView(result.ok ? result.days : [], [], 0, '2026-09-01', '2026-09')!;
    expect(view.lowest).toEqual({ date: '2026-09-20', balance: 100 });
  });

  it('reports the EARLIEST date of a flat run at the low, not the last', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-09-01', 500)],
      transactions: [tx({ date: '2026-09-04', amount: 450, type: 'expense' })], // 50, carried to month end
      windowStart: '2026-09-01', windowEnd: '2026-09-30', today: '2026-09-01',
    });
    const view = buildMonthView(result.ok ? result.days : [], [], 0, '2026-09-01', '2026-09')!;
    expect(view.lowest.balance).toBe(50);
    expect(view.lowest.date).toBe('2026-09-04'); // the day it dropped, not 2026-09-30
  });

  it('considers days with NO entries — the low can sit on an empty day', () => {
    // The minimum is reached on the 4th and every later empty day carries it;
    // computing over visibleDays only would still find 50 here, so the real
    // guard is the day AFTER a drop being eligible at all.
    const result = buildCashTimeline({
      anchors: [anchor('2026-09-01', 500)],
      transactions: [
        tx({ date: '2026-09-04', amount: 450, type: 'expense' }),  // 50
        tx({ date: '2026-09-28', amount: 900, type: 'income' }),   // 950
      ],
      windowStart: '2026-09-01', windowEnd: '2026-09-30', today: '2026-09-01',
    });
    const view = buildMonthView(result.ok ? result.days : [], [], 0, '2026-09-01', '2026-09')!;
    expect(view.lowest).toEqual({ date: '2026-09-04', balance: 50 });
    // and every day between is still part of the scan
    expect(view.visibleDays.length).toBe(2);
  });

  it('a month that only rises reports its opening day as the low', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-09-01', 200)],
      transactions: [tx({ date: '2026-09-15', amount: 800, type: 'income' })],
      windowStart: '2026-09-01', windowEnd: '2026-09-30', today: '2026-09-01',
    });
    const view = buildMonthView(result.ok ? result.days : [], [], 0, '2026-09-01', '2026-09')!;
    expect(view.lowest).toEqual({ date: '2026-09-01', balance: 200 });
  });

  it('a negative month low is reported as negative, not clamped', () => {
    const result = buildCashTimeline({
      anchors: [anchor('2026-09-01', 100)],
      transactions: [tx({ date: '2026-09-10', amount: 340, type: 'expense' })],
      windowStart: '2026-09-01', windowEnd: '2026-09-30', today: '2026-09-01',
    });
    const view = buildMonthView(result.ok ? result.days : [], [], 0, '2026-09-01', '2026-09')!;
    expect(view.lowest).toEqual({ date: '2026-09-10', balance: -240 });
  });
});
