import { describe, it, expect } from 'vitest';
import { cardFigure, cardsOverviewPath, loadCardMonths, loadCards, type CardRow } from '../lib/cardsLoader';
import { formatMonthLong } from '../lib/timelineView';
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

const VISA: CardRow = {
  id: 'c1', name: 'Visa', goal: 800, spent: 812.4, remaining: -12.4, status: 'over',
};
const MC: CardRow = {
  id: 'c2', name: 'Mastercard', goal: null, spent: 45, remaining: null, status: 'unset',
};

describe('loadCards', () => {
  it('asks for the household’s month, not the UTC one', async () => {
    const r = recorder({
      '/api/household/timezone': { timezone: 'America/Toronto' },
      [cardsOverviewPath('2026-09')]: { month: '2026-09', cards: [VISA] },
    });
    const load = await loadCards(r.get, LATE_SEPT_TORONTO);
    expect(r.asked).toEqual(['/api/household/timezone', '/api/cards/overview?month=2026-09']);
    expect(load).toEqual({ kind: 'ready', month: '2026-09', cards: [VISA] });
  });

  it('uses the household zone it is given, not Toronto, when they differ', async () => {
    // The same instant is 03:30 on 1 October in London: October's cards.
    const r = recorder({
      '/api/household/timezone': { timezone: 'Europe/London' },
      [cardsOverviewPath('2026-10')]: { month: '2026-10', cards: [VISA] },
    });
    const load = await loadCards(r.get, LATE_SEPT_TORONTO);
    expect(load.month).toBe('2026-10');
  });

  it('falls back to the default zone only when the route answers with none', async () => {
    const r = recorder({
      '/api/household/timezone': { timezone: '' },
      [cardsOverviewPath('2026-09')]: { month: '2026-09', cards: [VISA] },
    });
    expect((await loadCards(r.get, LATE_SEPT_TORONTO)).month).toBe('2026-09');
  });

  it('propagates a timezone failure rather than guessing the month', async () => {
    const r = recorder({ '/api/household/timezone': new Error('server') });
    await expect(loadCards(r.get, LATE_SEPT_TORONTO)).rejects.toThrow('server');
    expect(r.asked).toEqual(['/api/household/timezone']);
  });

  it('propagates an overview failure', async () => {
    const r = recorder({
      '/api/household/timezone': { timezone: 'America/Toronto' },
      [cardsOverviewPath('2026-09')]: new Error('down'),
    });
    await expect(loadCards(r.get, LATE_SEPT_TORONTO)).rejects.toThrow('down');
  });

  it('is noCards when the household has no credit card', async () => {
    const r = recorder({
      '/api/household/timezone': { timezone: 'America/Toronto' },
      [cardsOverviewPath('2026-09')]: { cards: [] },
    });
    expect(await loadCards(r.get, LATE_SEPT_TORONTO)).toEqual({ kind: 'noCards', month: '2026-09' });
  });

  it('refuses figures for a different month than it asked for', async () => {
    const r = recorder({
      '/api/household/timezone': { timezone: 'America/Toronto' },
      [cardsOverviewPath('2026-09')]: { month: '2026-08', cards: [VISA] },
    });
    await expect(loadCards(r.get, LATE_SEPT_TORONTO)).rejects.toThrow('2026-08');
  });

  it('passes every server figure through untouched, in the server’s order', async () => {
    const r = recorder({
      '/api/household/timezone': { timezone: 'America/Toronto' },
      [cardsOverviewPath('2026-09')]: { month: '2026-09', cards: [MC, VISA] },
    });
    const load = await loadCards(r.get, LATE_SEPT_TORONTO);
    expect(load.kind === 'ready' && load.cards).toEqual([MC, VISA]);
  });
});

describe('cardFigure — "—" for no figure, never $0', () => {
  it('renders null as an em dash', () => {
    expect(cardFigure(null, 'en')).toBe('—');
    expect(cardFigure(null, 'fr')).toBe('—');
  });

  it('renders a real zero as zero', () => {
    expect(cardFigure(0, 'en')).toBe('$0.00');
  });

  it('renders a negative room with its sign', () => {
    expect(cardFigure(-12.4, 'en')).toBe('-$12.40');
  });

  it('renders French with U+00A0 before the sign', () => {
    expect(cardFigure(1234.5, 'fr')).toBe('1 234,50 $');
  });
});

describe('formatMonthLong', () => {
  it.each([
    ['2026-09', 'en', 'September 2026'],
    ['2026-09', 'fr', 'septembre 2026'],
    ['2026-01', 'en', 'January 2026'],
    ['2026-12', 'fr', 'décembre 2026'],
  ] as const)('%s in %s → %s', (month, locale, expected) => {
    expect(formatMonthLong(month, locale)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Month navigation (2026-10-15).
// ---------------------------------------------------------------------------

describe('loadCards for a chosen month', () => {
  it('asks for that month and does not re-derive it from the clock', async () => {
    const r = recorder({ [cardsOverviewPath('2026-08')]: { month: '2026-08', cards: [VISA] } });
    const load = await loadCards(r.get, LATE_SEPT_TORONTO, '2026-08');
    expect(r.asked).toEqual(['/api/cards/overview?month=2026-08']);
    expect(load).toEqual({ kind: 'ready', month: '2026-08', cards: [VISA] });
  });

  it('still refuses figures for a different month than the one chosen', async () => {
    const r = recorder({ [cardsOverviewPath('2026-08')]: { month: '2026-09', cards: [VISA] } });
    await expect(loadCards(r.get, LATE_SEPT_TORONTO, '2026-08')).rejects.toThrow('answered for 2026-09, asked for 2026-08');
  });
});

describe("loadCardMonths: the web picker's own range", () => {
  it("passes the route's months and current month through", async () => {
    const r = recorder({
      '/api/cards/months': {
        months: ['2026-07', '2026-08', '2026-09', '2026-10'],
        floorMonth: '2026-07', currentMonth: '2026-09', horizonEndMonth: '2026-10', isPro: false, lockedMonthCount: 9,
      },
    });
    expect(await loadCardMonths(r.get)).toEqual({ months: ['2026-07', '2026-08', '2026-09', '2026-10'], currentMonth: '2026-09' });
  });

  it('refuses a months list that is not months', async () => {
    const r = recorder({ '/api/cards/months': { months: ['2026-7'], currentMonth: '2026-09' } });
    await expect(loadCardMonths(r.get)).rejects.toThrow('months is not a list of months');
  });

  it('refuses a missing months list rather than showing no range', async () => {
    const r = recorder({ '/api/cards/months': { currentMonth: '2026-09' } });
    await expect(loadCardMonths(r.get)).rejects.toThrow('months is not a list of months');
  });

  it('refuses a missing current month', async () => {
    const r = recorder({ '/api/cards/months': { months: ['2026-09'] } });
    await expect(loadCardMonths(r.get)).rejects.toThrow('currentMonth is not a month');
  });
});
