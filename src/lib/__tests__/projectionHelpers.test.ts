import { describe, it, expect } from 'vitest';
import {
  computeCardEnvelopeRemainders,
  computeProjectedMonthEnd,
  cycleFetchRange,
  type CardCycleRemainder,
} from '../projectionHelpers';

const CARD = { id: 'card-1', name: 'Visa', statement_close_day: null };

// CARD has no statement_close_day, so its cycle window falls back to the
// calendar month of cycleMonth. Fixtures below pick `today` explicitly per
// test to control whether that window reads as closed or still open.

describe('computeCardEnvelopeRemainders', () => {
  it('closed cycle uses actual, even under budget — nothing more can land in it', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [{ account_id: 'card-1', date: '2026-06-10', type: 'expense', amount: 100 }],
      cycleMonth: '2026-06', // window: 2026-06-01..2026-06-30
      today: '2026-07-05',  // after the cycle closed
    });
    expect(r.closed).toBe(true);
    expect(r.actual).toBe(100);
    expect(r.payment).toBe(100); // NOT the 500 budget
    expect(r.deduction).toBe(0); // already fully reflected via the real bridge
  });

  it('in-progress cycle, over budget: uses actual, not budget — the budget is counterfactual', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 650 }],
      cycleMonth: '2026-07', // window: 2026-07-01..2026-07-31
      today: '2026-07-20',  // still open
    });
    expect(r.closed).toBe(false);
    expect(r.actual).toBe(650);
    expect(r.payment).toBe(650); // NOT clamped down to the 500 budget
    expect(r.deduction).toBe(0); // 650 already recorded/reflected; nothing further to add
  });

  it('in-progress cycle, under budget: uses actual so far, not the budget (Lineu, 2026-11-13)', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 200 }],
      cycleMonth: '2026-07',
      today: '2026-07-20',
    });
    expect(r.closed).toBe(false);
    expect(r.inProgress).toBe(true);
    expect(r.actual).toBe(200);
    expect(r.payment).toBe(200); // NOT the 500 budget: the statement as it stands today
    expect(r.deduction).toBe(0);
  });

  it('a cycle starting today is in progress; the day before it starts, the budget stands in', () => {
    const card15 = { id: 'card-1', name: 'Visa', statement_close_day: 15 }; // Aug cycle: 07-16..08-15
    const args = {
      cards: [card15],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [{ account_id: 'card-1', date: '2026-07-16', type: 'expense', amount: 40 }],
      cycleMonth: '2026-08',
    };
    const [started] = computeCardEnvelopeRemainders({ ...args, today: '2026-07-16' });
    expect(started.inProgress).toBe(true);
    expect(started.payment).toBe(40);
    const [notYet] = computeCardEnvelopeRemainders({ ...args, today: '2026-07-15' });
    expect(notYet.inProgress).toBe(false);
    expect(notYet.closed).toBe(false);
    expect(notYet.payment).toBe(500);
  });

  it('a future cycle whose dated card entries already exceed the budget uses them (max)', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [{ account_id: 'card-1', date: '2026-11-03', type: 'expense', amount: 620 }],
      cycleMonth: '2026-11',
      today: '2026-07-20',
    });
    expect(r.inProgress).toBe(false);
    expect(r.payment).toBe(620);
  });

  it('a closed cycle is not in progress', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [],
      cycleMonth: '2026-06',
      today: '2026-07-05',
    });
    expect(r.closed).toBe(true);
    expect(r.inProgress).toBe(false);
  });

  it('entirely future cycle (no transactions yet) uses the budget as the planning value', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 500]]),
      transactions: [], // nothing recorded yet
      cycleMonth: '2026-11',
      today: '2026-07-20', // well before the cycle even starts
    });
    expect(r.closed).toBe(false);
    expect(r.actual).toBe(0);
    expect(r.payment).toBe(500);
    expect(r.deduction).toBe(500); // the whole budget, since nothing is in the bridge yet
    expect(r.noData).toBe(false); // a budget exists — this is a real planning figure, not "no data"
  });

  it('no envelope but real spending: still counts the actual spend, never treated as zero', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map(), // never configured
      transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 320 }],
      cycleMonth: '2026-07',
      today: '2026-07-20',
    });
    expect(r.budget).toBeNull();
    expect(r.actual).toBe(320);
    expect(r.payment).toBe(320); // real spend counted, not excluded
    expect(r.deduction).toBe(0); // already reflected via the real bridge — no extra subtraction needed
    expect(r.noData).toBe(false); // has real data — must NOT be disclosed as "excluded"
  });

  it('no envelope but real spending, cycle already closed: still the real actual, not zero', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map(),
      transactions: [{ account_id: 'card-1', date: '2026-06-05', type: 'expense', amount: 85 }],
      cycleMonth: '2026-06',
      today: '2026-07-05',
    });
    expect(r.closed).toBe(true);
    expect(r.actual).toBe(85);
    expect(r.payment).toBe(85);
    expect(r.noData).toBe(false);
  });

  it('no envelope and no actual data: contributes nothing and is flagged for disclosure', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map(),
      transactions: [],
      cycleMonth: '2026-11',
      today: '2026-07-20',
    });
    expect(r.budget).toBeNull();
    expect(r.actual).toBe(0);
    expect(r.payment).toBe(0);
    expect(r.deduction).toBe(0);
    expect(r.noData).toBe(true); // genuinely nothing to project — must be disclosed
  });

  it('a refund-heavy cycle (net actual negative) with no budget still contributes zero, not a negative payment, and counts as no-data', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map(),
      transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'income', amount: 50 }], // pure refund
      cycleMonth: '2026-07',
      today: '2026-07-20',
    });
    expect(r.actual).toBe(-50);
    expect(r.payment).toBe(0); // floored — never a negative projected payment
    expect(r.noData).toBe(true); // nothing owed and no budget — genuinely nothing to project
  });

  it('a card explicitly budgeted at $0 is a real budget, not "no data"', () => {
    const [r] = computeCardEnvelopeRemainders({
      cards: [CARD],
      cardBudgets: new Map([['card-1', 0]]),
      transactions: [],
      cycleMonth: '2026-11',
      today: '2026-07-20',
    });
    expect(r.budget).toBe(0);
    expect(r.payment).toBe(0);
    expect(r.noData).toBe(false); // a $0 envelope was explicitly set — that's data, not absence of it
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
      today: '2026-07-20',
    });
    expect(r.actual).toBe(200);
    expect(r.payment).toBe(200); // in progress → net actual so far
    expect(r.deduction).toBe(0);
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

  describe('closed-cycle boundary', () => {
    it('a cycle that closes exactly today is still open — in progress, so actual so far', () => {
      const [r] = computeCardEnvelopeRemainders({
        cards: [CARD],
        cardBudgets: new Map([['card-1', 500]]),
        transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 200 }],
        cycleMonth: '2026-07', // window end: 2026-07-31
        today: '2026-07-31',
      });
      expect(r.closed).toBe(false);
      expect(r.inProgress).toBe(true);
      expect(r.payment).toBe(200);
    });

    it('the day after the close date, the cycle is closed', () => {
      const [r] = computeCardEnvelopeRemainders({
        cards: [CARD],
        cardBudgets: new Map([['card-1', 500]]),
        transactions: [{ account_id: 'card-1', date: '2026-07-05', type: 'expense', amount: 200 }],
        cycleMonth: '2026-07',
        today: '2026-08-01',
      });
      expect(r.closed).toBe(true);
      expect(r.payment).toBe(200);
    });
  });
});

describe('computeProjectedMonthEnd', () => {
  it('subtracts only the deduction (unspent budget beyond real recorded spend) from the closing balance', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: 500, actual: 200, closed: false, inProgress: false, payment: 500, deduction: 300, noData: false },
    ];
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(700);
  });

  it('never double-counts: a cycle already fully reflected in the closing balance contributes nothing further', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: 500, actual: 500, closed: false, inProgress: false, payment: 500, deduction: 0, noData: false },
    ];
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(1000);
  });

  it('sums deductions across multiple cards', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: 500, actual: 200, closed: false, inProgress: false, payment: 500, deduction: 300, noData: false },
      { cardId: 'card-2', cardName: 'Mastercard', budget: 200, actual: 50, closed: false, inProgress: false, payment: 200, deduction: 150, noData: false },
    ];
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(550);
  });

  it('never silently ignores real card spending: a no-envelope card with actual spend contributes exactly its actual, via the baseline, with zero further deduction', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: null, actual: 320, closed: false, inProgress: false, payment: 320, deduction: 0, noData: false },
    ];
    // closingBalance passed in already reflects the real 320 via the bridge —
    // the projection must not additionally add OR remove anything for it.
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(1000);
  });

  it('a genuinely no-data card contributes nothing', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: null, actual: 0, closed: false, inProgress: false, payment: 0, deduction: 0, noData: true },
    ];
    expect(computeProjectedMonthEnd(1000, remainders)).toBe(1000);
  });

  it('a closed cycle contributes nothing further, even if it finished under budget', () => {
    const remainders: CardCycleRemainder[] = [
      { cardId: 'card-1', cardName: 'Visa', budget: 500, actual: 100, closed: true, inProgress: false, payment: 100, deduction: 0, noData: false },
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
