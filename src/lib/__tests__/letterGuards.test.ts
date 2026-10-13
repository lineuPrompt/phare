import { describe, it, expect } from 'vitest';
import {
  checkLetterFigures,
  extractDollarFigures,
  findNamesNotInPayload,
  payloadCents,
  LetterGuardError,
} from '@/lib/letterGuards';

// ---------------------------------------------------------------------------
// The letter guards (2026-10-10): every dollar figure in a letter is one its
// payload holds, to the cent; every card or category it names is one the
// payload's cards carry. The texts below are September 2026's real failures
// and their nearest honest neighbours.
// ---------------------------------------------------------------------------

describe('extractDollarFigures', () => {
  it('reads English figures, with and without cents, separators and signs', () => {
    expect(extractDollarFigures('Income was $14,580.42, rent $3,000, a fee of $5 and −$115.34 at the low.').map((f) => f.cents))
      .toEqual([1458042, 300000, 500, 11534]);
  });

  it('reads fr-CA figures with U+00A0, U+202F or a plain space, sign after', () => {
    const text = 'Revenu de 14\u00A0580,42\u00A0$, loyer 3\u202F000 $ et frais de 5,50 $.';
    expect(extractDollarFigures(text).map((f) => f.cents)).toEqual([1458042, 300000, 550]);
  });

  it('reads a figure written with a word', () => {
    expect(extractDollarFigures('about 2,451 dollars').map((f) => f.cents)).toEqual([245100]);
  });

  it('ignores numbers that are not money: dates, counts, months', () => {
    expect(extractDollarFigures('On November 25, 2026, after 3 months, in 2028.')).toEqual([]);
  });
});

describe('checkLetterFigures', () => {
  const payload = { month: { income: 14580.42, expenses: 12574.17 }, goals: [{ targetAmount: 13000, requiredMonthly: 489.04 }], monthsUntilDue: 5 };

  it('passes figures the payload holds, written either way', () => {
    expect(checkLetterFigures('You earned $14,580.42 and spent 12\u00A0574,17\u00A0$. Your target is $13,000.', payload))
      .toEqual({ ok: true, offending: [] });
  });

  it('refuses a sum the model made: "roughly $2,451" (September 2026)', () => {
    expect(checkLetterFigures('Those four lines totalled roughly $2,451 combined.', payload))
      .toEqual({ ok: false, offending: ['$2,451'] });
  });

  it('a whole-dollar figure passes when a payload figure rounds to it (2026-10-11): "$192" for 192.31, EN and FR', () => {
    const p = { goals: [{ requiredMonthly: 192.31 }] };
    expect(checkLetterFigures('The date needs $192 a month.', p)).toEqual({ ok: true, offending: [] });
    expect(checkLetterFigures('La date demande 192 $ par mois.', p)).toEqual({ ok: true, offending: [] });
    expect(checkLetterFigures('La date demande 192 $ par mois.', p).ok).toBe(true);
  });

  it('x.50 rounds up', () => {
    expect(checkLetterFigures('$193 a month.', { a: 192.5 }).ok).toBe(true);
    expect(checkLetterFigures('$192 a month.', { a: 192.5 }).ok).toBe(false);
  });

  it('a whole-dollar figure one dollar away fails: "$193" against 192.31', () => {
    expect(checkLetterFigures('The date needs $193 a month.', { goals: [{ requiredMonthly: 192.31 }] }).offending).toEqual(['$193']);
    expect(checkLetterFigures('La date demande 193 $ par mois.', { goals: [{ requiredMonthly: 192.31 }] }).offending).toEqual(['193 $']);
  });

  it('a figure with cents must match to the cent: one cent off fails', () => {
    const p = { goals: [{ requiredMonthly: 192.31 }] };
    expect(checkLetterFigures('$192.31 a month.', p).ok).toBe(true);
    expect(checkLetterFigures('$192.32 a month.', p).offending).toEqual(['$192.32']);
    expect(checkLetterFigures('192,30 $ par mois.', p).offending).toEqual(['192,30 $']);
    // Written with cents, so it is held to the cent: rounding does not apply.
    expect(checkLetterFigures('$192.00 a month.', p).offending).toEqual(['$192.00']);
  });

  it('a sum the model made still fails though each part is in the payload: "$2,451" (the September 2026 shape)', () => {
    // Four payload lines whose total, 2450.85, is in no payload field — the
    // letter wrote their sum, rounded. No single figure rounds to 2,451.
    const p = { expenseLines: [{ actual: 975.47 }, { actual: 449.6 }, { actual: 520.78 }, { actual: 505 }], month: { expenses: 12588.76 } };
    expect(checkLetterFigures('Those four lines totalled roughly $2,451 combined.', p).offending).toEqual(['$2,451']);
  });

  it('a sum with cents still fails: "$207.49" from two installments (the August 2026 shape)', () => {
    const p = { coaching: { freedCapacityEvents: [{ amount: 108 }, { amount: 99.49 }] } };
    expect(checkLetterFigures('That combined $207.49 a month of freed capacity.', p).offending).toEqual(['$207.49']);
  });

  it('a whole-dollar figure passes only when the payload holds that whole number', () => {
    expect(checkLetterFigures('Your $13,000 target.', payload).ok).toBe(true);
    expect(checkLetterFigures('Your $13,000.00 target.', payload).ok).toBe(true);
  });

  it('refuses percentages and abbreviations outright', () => {
    expect(checkLetterFigures('That is 18% of income, or about $2.4k.', payload).offending).toEqual(['$2.4k', '18%']);
    expect(checkLetterFigures('Soit 18,5 pour cent du revenu.', payload).offending).toEqual(['18,5 pour cent']);
  });

  it('a negative balance may be written without its sign', () => {
    expect(checkLetterFigures('It dips $115.34 below zero.', { monthAhead: { lowestBalance: -115.34 } }).ok).toBe(true);
  });
});

describe('payloadCents', () => {
  it('collects every number at any depth, as absolute cents; strings are not numbers', () => {
    expect([...payloadCents({ a: 1.5, b: [{ c: -2 }, '3'], d: { e: { f: 0.1 } } })].sort((x, y) => x - y)).toEqual([10, 150, 200]);
  });
});

describe('findNamesNotInPayload', () => {
  const known = ['Shopping', 'Unexpected', 'Groceries & Pharmacy', 'Costco', 'Costco Lineu', 'Épicerie et pharmacie'];

  it('a name the payload\'s cards carry passes; one they do not is reported', () => {
    expect(findNamesNotInPayload('Shopping ran ahead; Groceries & Pharmacy too.', known, ['Shopping'])).toEqual(['Groceries & Pharmacy']);
  });

  it('case-sensitive: lower-case prose is not the category', () => {
    expect(findNamesNotInPayload('An unexpected bill, and some shopping.', known, [])).toEqual([]);
  });

  it('a known name inside an allowed one is not a violation', () => {
    expect(findNamesNotInPayload('Costco Lineu ran past its goal.', known, ['Costco Lineu'])).toEqual([]);
    expect(findNamesNotInPayload('Costco ran past its goal.', known, ['Costco Lineu'])).toEqual(['Costco']);
  });

  it('whole names only, accents included', () => {
    expect(findNamesNotInPayload('Les Shoppings du centre.', known, [])).toEqual([]);
    expect(findNamesNotInPayload('Épicerie et pharmacie a dépassé.', known, [])).toEqual(['Épicerie et pharmacie']);
  });
});

describe('LetterGuardError', () => {
  it('says what failed, figures and names', () => {
    const e = new LetterGuardError(['$2,451'], ['Shopping']);
    expect(e.message).toContain('$2,451');
    expect(e.message).toContain('Shopping');
    expect(e.figures).toEqual(['$2,451']);
    expect(e.names).toEqual(['Shopping']);
  });
});
