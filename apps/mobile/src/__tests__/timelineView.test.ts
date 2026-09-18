import { describe, it, expect } from 'vitest';
import {
  buildMonthView,
  classifyDip,
  DIP_AMBER_THRESHOLD,
  type TimelineDay,
  type TimelineEntry,
} from '@phare/core';
// The web app's own import path for the same helpers. Importing it here is the
// point of the test below: it proves the two apps resolve to ONE function, not
// to two copies that agree today. Test files are excluded from the compliance
// scan that forbids app code reaching into the web src/.
import { classifyDip as classifyDipViaWebPath, DIP_AMBER_THRESHOLD as WEB_THRESHOLD } from '../../../../src/lib/timelineHelpers';
import { buildMonthView as buildMonthViewViaWebPath } from '../../../../src/lib/timelineDisplayHelpers';
import { buildTimelineView, entryAmount, formatDayLong, formatDayShort } from '../lib/timelineView';
import type { TimelineOk } from '../lib/timeline';

// ---------------------------------------------------------------------------
// The Timeline screen's logic. No component is rendered here — this app has no
// React Native test renderer (see vitest.config.ts), which is exactly why the
// screen's decisions live in pure modules and are tested through them.
// ---------------------------------------------------------------------------

function entry(over: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    date: over.date ?? '2026-09-15',
    description: over.description ?? 'Groceries',
    amount: over.amount ?? 100,
    type: over.type ?? 'expense',
    recurringItemId: over.recurringItemId ?? null,
    recurrenceId: null,
    installmentLabel: over.installmentLabel ?? null,
    transferPeerId: over.transferPeerId ?? null,
    isBridge: over.isBridge ?? false,
    bridgeSourceAccount: null,
    bridgeSourceMonth: null,
    signedAmount: over.signedAmount ?? -100,
    isFuture: over.isFuture ?? false,
  };
}

function day(date: string, balance: number, entries: TimelineEntry[] = []): TimelineDay {
  return { date, entries, endOfDayBalance: balance, isNegative: balance < 0 };
}

function payload(over: Partial<TimelineOk> = {}): TimelineOk {
  return {
    ok: true,
    balancesStartDate: over.balancesStartDate ?? '2026-09-01',
    openingBalance: over.openingBalance ?? 1000,
    closingBalance: over.closingBalance ?? 1000,
    todayBalance: over.todayBalance ?? 900,
    days: over.days ?? [],
    dip: over.dip ?? null,
    nextIncomeDate: over.nextIncomeDate ?? null,
    unbalancedDays: over.unbalancedDays ?? [],
    horizonEndMonth: over.horizonEndMonth,
    isPro: over.isPro,
  };
}

describe('the amber tier is the web app\'s amber tier', () => {
  // THE REASON THE SHARED-PACKAGE MOVE EXISTS. Before it, the tier lived in
  // the web app's src/lib, unreachable from here — so mobile would have needed
  // its own copy of "$200", and the same dip could read amber on the web page
  // and healthy on the phone. These assertions fail if the two paths ever stop
  // being the same code.
  it('is literally the same function object through both import paths', () => {
    expect(classifyDipViaWebPath).toBe(classifyDip);
    expect(WEB_THRESHOLD).toBe(DIP_AMBER_THRESHOLD);
    expect(buildMonthViewViaWebPath).toBe(buildMonthView);
  });

  it.each([
    ['a dip below zero', -0.01, 'red'],
    ['exactly zero', 0, 'amber'],
    ['a cent under the threshold', DIP_AMBER_THRESHOLD - 0.01, 'amber'],
    ['exactly the threshold', DIP_AMBER_THRESHOLD, 'healthy'],
    ['comfortably above', 4070, 'healthy'],
  ])('agrees on %s', (_label, balance, expected) => {
    const dip = { date: '2026-09-28', balance };
    expect(classifyDip(dip)).toBe(expected);
    expect(classifyDipViaWebPath(dip)).toBe(expected);
  });

  it('agrees that no dip is not a tier', () => {
    expect(classifyDip(null)).toBe('none');
    expect(classifyDipViaWebPath(null)).toBe('none');
  });

  it('carries the tier into the view built for the screen', () => {
    const view = buildTimelineView(
      payload({
        days: [day('2026-09-15', 900, [entry()])],
        dip: { date: '2026-09-16', balance: DIP_AMBER_THRESHOLD - 1 },
        nextIncomeDate: '2026-09-30',
      }),
      '2026-09-15'
    );
    expect(view.dipStatus).toBe('amber');
  });
});

describe('the current month and the run-on to next pay', () => {
  const sep = [
    day('2026-09-14', 1000, [entry({ id: 'a', date: '2026-09-14' })]),
    day('2026-09-15', 900, [entry({ id: 'b', date: '2026-09-15' })]),
    day('2026-09-16', 900),
    day('2026-09-30', 300, [entry({ id: 'c', date: '2026-09-30' })]),
  ];
  const oct = [
    day('2026-10-01', 100, [entry({ id: 'd', date: '2026-10-01' })]),
    day('2026-10-02', 100),
    day('2026-10-03', 2100, [entry({ id: 'e', date: '2026-10-03', type: 'income', amount: 2000 })]),
    day('2026-10-04', 2000, [entry({ id: 'f', date: '2026-10-04' })]),
  ];

  it('shows days after the month end up to the pay date, and no further', () => {
    const view = buildTimelineView(
      payload({ days: [...sep, ...oct], dip: { date: '2026-10-01', balance: 100 }, nextIncomeDate: '2026-10-03' }),
      '2026-09-15'
    );
    const dates = view.rows.filter((r) => r.kind === 'day').map((r) => r.day.date);
    expect(dates).toEqual(['2026-09-14', '2026-09-15', '2026-09-30', '2026-10-01', '2026-10-03']);
    // 4 October is past the pay date: out.
    expect(dates).not.toContain('2026-10-04');
  });

  it('labels the run-on with the pay date it runs to', () => {
    const view = buildTimelineView(
      payload({ days: [...sep, ...oct], nextIncomeDate: '2026-10-03' }),
      '2026-09-15'
    );
    const runOn = view.rows.find((r) => r.kind === 'runOn');
    expect(runOn).toEqual({ kind: 'runOn', payday: '2026-10-03' });
    // It sits immediately before the first day of the next month.
    const at = view.rows.indexOf(runOn!);
    expect(view.rows[at + 1]).toMatchObject({ kind: 'day', day: { date: '2026-10-01' } });
  });

  it('does not run on when the next pay is inside this month', () => {
    const view = buildTimelineView(
      payload({ days: [...sep, ...oct], nextIncomeDate: '2026-09-30' }),
      '2026-09-15'
    );
    expect(view.rows.some((r) => r.kind === 'runOn')).toBe(false);
    expect(view.rows.filter((r) => r.kind === 'day').every((r) => r.day.date < '2026-10-01')).toBe(true);
  });

  it('stops the run-on at the entitled horizon', () => {
    // A free household's horizon ends this month: the route still RETURNS
    // October's days (it trims navigation, not data), so an uncapped run-on
    // would show projection the web app withholds.
    const view = buildTimelineView(
      payload({
        days: [...sep, ...oct],
        nextIncomeDate: '2026-10-03',
        horizonEndMonth: '2026-09',
      }),
      '2026-09-15'
    );
    expect(view.rows.filter((r) => r.kind === 'day').map((r) => r.day.date)).toEqual([
      '2026-09-14', '2026-09-15', '2026-09-30',
    ]);
  });

  it('shows the dip\'s own day even with no entries on it', () => {
    // 16 September has no entries: the web page would omit it. The banner
    // names it, so it must be on screen.
    const view = buildTimelineView(
      payload({ days: sep, dip: { date: '2026-09-16', balance: 900 }, nextIncomeDate: '2026-09-30' }),
      '2026-09-15'
    );
    expect(view.rows.filter((r) => r.kind === 'day').map((r) => r.day.date)).toContain('2026-09-16');
  });

  it('marks the projection boundary once, before the first future day', () => {
    const view = buildTimelineView(payload({ days: sep }), '2026-09-15');
    const kinds = view.rows.map((r) => r.kind);
    expect(kinds.filter((k) => k === 'projection')).toHaveLength(1);
    const at = kinds.indexOf('projection');
    // Everything before it is today or earlier; everything after is later.
    const before = view.rows.slice(0, at).filter((r) => r.kind === 'day');
    const after = view.rows.slice(at).filter((r) => r.kind === 'day');
    expect(before.every((r) => r.day.date <= '2026-09-15')).toBe(true);
    expect(after.every((r) => r.day.date > '2026-09-15')).toBe(true);
  });

  it('scrolls to today when today has entries, and to the projection line otherwise', () => {
    const withToday = buildTimelineView(payload({ days: sep }), '2026-09-15');
    expect(withToday.rows[withToday.scrollToRow!]).toMatchObject({ kind: 'day', isToday: true });

    // Today (the 17th) has no entries at all — no today row exists to scroll to.
    const noToday = buildTimelineView(payload({ days: sep }), '2026-09-17');
    expect(noToday.rows[noToday.scrollToRow!]).toMatchObject({ kind: 'projection' });
  });

  it('reports the month having no days rather than inventing a zero', () => {
    // The anchor is next month: this month has no balances at all.
    const view = buildTimelineView(
      payload({ balancesStartDate: '2026-10-05', days: oct }),
      '2026-09-15'
    );
    expect(view.monthView).toBeNull();
    expect(view.lowestStatus).toBeNull();
  });

  it('keeps pre-anchor days visible and dates the note to the real start', () => {
    const view = buildTimelineView(
      payload({
        balancesStartDate: '2026-09-10',
        days: [day('2026-09-10', 1000, [entry({ id: 'x', date: '2026-09-10' })])],
        unbalancedDays: [{ date: '2026-09-03', entries: [entry({ id: 'y', date: '2026-09-03' })] }],
      }),
      '2026-09-15'
    );
    expect(view.rows[0]).toMatchObject({ kind: 'unbalanced', day: { date: '2026-09-03' } });
    // The date is balancesStartDate, NOT the 1st of the month. The web page
    // passes the 1st here, which is the one date the note is never about.
    expect(view.rows[1]).toEqual({ kind: 'balancesBegin', date: '2026-09-10' });
  });
});

describe('dates do not depend on the device clock', () => {
  // The web app builds `new Date(iso + 'T00:00:00')` — midnight in the
  // DEVICE's zone. On a phone west of the household that is the previous day,
  // and every row would be labelled a day early. Noon UTC + timeZone: 'UTC'
  // cannot drift in any zone.
  const original = process.env.TZ;
  const inZone = (tz: string, run: () => string) => {
    process.env.TZ = tz;
    try {
      return run();
    } finally {
      process.env.TZ = original;
    }
  };

  it.each(['UTC', 'Pacific/Kiritimati', 'Pacific/Midway', 'America/Toronto'])(
    'formats the same date in %s',
    (tz) => {
      expect(inZone(tz, () => formatDayShort('2026-09-30', 'en'))).toContain('30');
      expect(inZone(tz, () => formatDayLong('2026-09-30', 'fr'))).toContain('30');
    }
  );

  it('renders both locales', () => {
    expect(formatDayLong('2026-09-30', 'en')).toBe('September 30');
    expect(formatDayLong('2026-09-30', 'fr')).toBe('30 septembre');
  });
});

describe('entry amounts', () => {
  it('reads income as money in', () => {
    const { text, tone } = entryAmount({ amount: 2000, type: 'income' }, 'en');
    expect(tone).toBe('income');
    expect(text.startsWith('+')).toBe(true);
  });

  it('reads a debt draw as money in, but not as income', () => {
    // A negative transfer on the chequing account is a draw: borrowed cash
    // arriving. It must never colour like a paycheque.
    const draw = entryAmount({ amount: -500, type: 'transfer' }, 'en');
    expect(draw.tone).toBe('draw');
    expect(draw.text.startsWith('+')).toBe(true);
    expect(draw.text).not.toContain('-');
  });

  it('reads a contribution and an expense plainly', () => {
    expect(entryAmount({ amount: 500, type: 'transfer' }, 'en').tone).toBe('plain');
    expect(entryAmount({ amount: 100, type: 'expense' }, 'en').tone).toBe('plain');
  });

  it('formats in the household locale', () => {
    // fr-CA puts the sign after the figure with U+00A0 separators —
    // formatCADLocale's whole reason for existing.
    expect(entryAmount({ amount: 1234.5, type: 'expense' }, 'fr').text).toBe(
      String.fromCharCode(49, 160, 50, 51, 52, 44, 53, 48, 160, 36)
    );
  });
});
