import { describe, it, expect } from 'vitest';
import {
  computeCardEnvelopeRemainders,
  computeProjectedMonthEnd,
  cycleFetchRange,
  type CardCycleRemainder,
} from '../projectionHelpers';

const CARD = { id: 'card-1', name: 'Visa', statement_close_day: null };

// Mid-cycle "today" for CARD's (calendar-month, no statement_close_day)
// 2026-07 cycle, whose window is 2026-07-01..2026-07-31 — before the end,
// so these fixtures exercise the still-open/in-progress path unless a test
// says otherwise.
const OPEN_TODAY = '2026-07-20';

describe('computeCardEnvelopeRemainders', () => {
  it('remaining = budget minus actual spend already recorded this cycle', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 200 }],
      cycleMonth: '2026-07',
      today: OPEN_TODAY,
    });
    expect(r.actual).toBe(200);
    expect(r.remaining).toBe(300);
    expect(r.unbudgeted).toBe(false);
    expect(r.closed).toBe(false);
  });

  it('does not double-count: actual spend equal to budget leaves zero remaining', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 500 }],
      cycleMonth: '2026-07',
      today: OPEN_TODAY,
    });
    expect(r.remaining).toBe(0);
  });

  it('over-budget cycle contributes zero remaining, not a negative number', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 650 }],
      cycleMonth: '2026-07',
      today: OPEN_TODAY,
    });
    expect(r.actual).toBe(650);
    expect(r.remaining).toBe(0);
    expect(r.unbudgeted).toBe(false);
  });

  it('a card with no saved envelope is excluded (remaining 0) and flagged unbudgeted, actual still computed', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map(), // no entry at all — never invent a budget
      transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 200 }],
      cycleMonth: '2026-07',
      today: OPEN_TODAY,
    });
    expect(r.budget).toBeNull();
    expect(r.unbudgeted).toBe(true);
    expect(r.remaining).toBe(0);
    expect(r.actual).toBe(200);
  });

  it('a card explicitly budgeted at $0 is NOT treated as unbudgeted', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 0]]),
      transactions: [],
      cycleMonth: '2026-07',
      today: OPEN_TODAY,
    });
    expect(r.unbudgeted).toBe(false);
    expect(r.budget).toBe(0);
    expect(r.remaining).toBe(0);
  });

  it('nets refunds against spend within the cycle, same rule as bridgeHelpers', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [
        { account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 300 },
        { account_id: 'card-1', date: '2026-07-10', type: 'income', amount: 100 }, // refund
      ],
      cycleMonth: '2026-07',
      today: OPEN_TODAY,
    });
    expect(r.actual).toBe(200);
    expect(r.remaining).toBe(300);
  });

  it('scopes each card to its own statement cycle window and ignores other cards entries', () => {
    const cardB = { id: 'card-2', name: 'Mastercard', statement_close_day: 15 };
    const remainders = computeCardEnvelopeRemainders({
      cards: [CARD, cardB],
      cardBudgets: new Map([['card-1', 500], ['card-2', 300]]),
      transactions: [
        { account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 100 },
        { account_id: 'card-2', date: '2026-07-05', type: 'expense', amount: 50 }, // in card-2's July cycle (close 15)
        { account_id: 'card-2', date: '2026-07-20', type: 'expense', amount: 999 }, // AFTER card-2's July close — belongs to August cycle
      ],
      cycleMonth: '2026-07',
      today: '2026-07-10', // before both cards' cycle-end dates — neither is closed yet
    });
    const byId = new Map(remainders.map((r) => [r.cardId, r]));
    expect(byId.get('card-1')!.actual).toBe(100);
    expect(byId.get('card-2')!.actual).toBe(50); // the 999 entry must not leak into this cycle
  });

  describe('already-closed cycles', () => {
    it('forces remaining to zero even when under budget — no more spend can land in a closed cycle', () => {
      const [r] = computeCardEnvelopeRemainders({
        cards: [CARD],
        cardBudgets: new Map([['card-1', 500]]),
        transactions: [{ account_id: 'card-1', date: '2026-06-10', type: 'expense', amount: 100 }],
        cycleMonth: '2026-06', // window: 2026-06-01..2026-06-30
        today: '2026-07-05',  // well after the cycle closed
      });
      expect(r.closed).toBe(true);
      expect(r.actual).toBe(100); // the real, final recorded spend — untouched
      expect(r.remaining).toBe(0); // NOT budget(500) - actual(100) = 400
    });

    it('a cycle that closes exactly today is still treated as open (today itself can still get an entry)', () => {
      const [r] = computeCardEnvelopeRemainders({
        cards: [CARD],
        cardBudgets: new Map([['card-1', 500]]),
        transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 200 }],
        cycleMonth: '2026-07', // window end: 2026-07-31
        today: '2026-07-31',
      });
      expect(r.closed).toBe(false);
      expect(r.remaining).toBe(300);
    });

    it('the day after the close date, the cycle is closed', () => {
      const [r] = computeCardEnvelopeRemainders({
        cards: [CARD],
        cardBudgets: new Map([['card-1', 500]]),
        transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 200 }],
        cycleMonth: '2026-07', // window end: 2026-07-31
        today: '2026-08-01',
      });
      expect(r.closed).toBe(true);
      expect(r.remaining).toBe(0);
    });

    it('an unbudgeted closed cycle is still reported closed (both flags independent)', () => {
      const [r] = computeCardEnvelopeRemainders({
        cards: [CARD],
        cardBudgets: new Map(),
        transactions: [],
        cycleMonth: '2026-06',
        today: '2026-07-05',
      });
      expect(r.unbudgeted).toBe(true);
      expect(r.closed).toBe(true);
      expect(r.remaining).toBe(0);
    });
  });
});

describe('computeProjectedMonthEnd', () => {
  it('subtracts only the unspent remainder from the timeline closing balance', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: 500, actual: 200, remaining: 300, unbudgeted: false, closed: false },
    ];
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(700);
  });

  it('never double-counts: a cycle already fully reflected in the closing balance contributes nothing further', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: 500, actual: 500, remaining: 0, unbudgeted: false, closed: false },
    ];
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(1000);
  });

  it('sums remaining across multiple cards', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: 500, actual: 200, remaining: 300, unbudgeted: false, closed: false },
      { cardId: 'card-2', cardName: 'Mastercard', budget: 200, actual: 50, remaining: 150, unbudgeted: false, closed: false },
    ];
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(550);
  });

  it('an unbudgeted card contributes nothing (never fabricates a budget)', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: null, actual: 200, remaining: 0, unbudgeted: true, closed: false },
    ];
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(1000);
  });

  it('a closed cycle contributes nothing further, even if it finished under budget', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: 500, actual: 100, remaining: 0, unbudgeted: false, closed: true },
    ];
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(1000);
  });
});

describe('cycleFetchRange', () => {
  it('returns null for no cards', () => {
    expect(cycleFetchRange([], '2026-07')).toBeNull();
  });

  it('unions the widest window across cards with different close days', () => {
    const range = cycleFetchRange(
      [{ statement_close_day: 5 }, { statement_close_day: 27 }],
      '2026-07'
    );
    // card A: 2026-06-06..2026-07-05, card B: 2026-06-28..2026-07-27
    expect(range).toEqual({ start: '2026-06-06', end: '2026-07-27' });
  });

  it('falls back to the calendar month when statement_close_day is null', () => {
    const range = cycleFetchRange([{ statement_close_day: null }], '2026-07');
    expect(range).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });
});
