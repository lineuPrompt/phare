import { describe, it, expect } from 'vitest';
import { parseAmountInput, canSaveExpense } from '../entry';

describe('parseAmountInput — exact or nothing', () => {
  it('reads a fr-CA keypad comma as a decimal point, never as a stop', () => {
    // parseFloat('12,50') is 12. This is the bug the parser exists for.
    expect(parseAmountInput('12,50')).toBe(12.5);
  });

  it('reads a decimal point', () => {
    expect(parseAmountInput('12.50')).toBe(12.5);
  });

  it('reads one decimal digit and whole numbers', () => {
    expect(parseAmountInput('12,5')).toBe(12.5);
    expect(parseAmountInput('12')).toBe(12);
  });

  it('ignores surrounding whitespace', () => {
    expect(parseAmountInput('  7,25 ')).toBe(7.25);
  });

  it('reads a leading minus; positivity is the caller’s rule', () => {
    expect(parseAmountInput('-40')).toBe(-40);
  });

  it('never hands out a signed zero', () => {
    expect(Object.is(parseAmountInput('-0'), 0)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'blank'],
    ['12.345', 'a third decimal — refused, not rounded'],
    ['1,234', 'a grouping comma — ambiguous across locales'],
    ['1,234.56', 'two separators'],
    ['1 234,56', 'a grouping space'],
    ['1 234,56', 'a grouping no-break space'],
    ['12.', 'a trailing separator'],
    [',50', 'no integer part'],
    ['$12', 'a currency sign'],
    ['12 $', 'a trailing currency sign'],
    ['12abc', 'trailing letters — parseFloat would read 12'],
    ['1e3', 'exponent notation'],
    ['0x10', 'hex'],
    ['--5', 'a double sign'],
    ['+5', 'a plus sign'],
    ['1234567890', 'ten integer digits — oversized, refused not clipped'],
  ])('refuses %j (%s)', (raw) => {
    expect(parseAmountInput(raw)).toBeNull();
  });

  it('accepts the largest allowed figure exactly', () => {
    expect(parseAmountInput('999999999,99')).toBe(999999999.99);
  });
});

describe('canSaveExpense — the submit button gate', () => {
  const ok = {
    description: 'Groceries',
    amount: 12.5,
    entryType: 'expense' as const,
    categoryId: 'cat-1',
    accountCount: 2,
    selectedAccountId: 'acct-1',
  };

  it('allows a complete expense', () => {
    expect(canSaveExpense(ok)).toBe(true);
  });

  it('needs a description that is not only whitespace', () => {
    expect(canSaveExpense({ ...ok, description: '   ' })).toBe(false);
  });

  it.each<[number | null, string]>([
    [0, 'zero'],
    [-5, 'negative'],
    [Number.NaN, 'NaN (what parseFloat gives the web form for junk)'],
    [null, 'null (what parseAmountInput gives mobile for junk)'],
  ])('refuses amount %s (%s)', (amount) => {
    expect(canSaveExpense({ ...ok, amount })).toBe(false);
  });

  it('needs a category for money out', () => {
    expect(canSaveExpense({ ...ok, categoryId: '' })).toBe(false);
  });

  it('does not need a category for money in', () => {
    expect(canSaveExpense({ ...ok, entryType: 'income', categoryId: '' })).toBe(true);
  });

  it('needs an account chosen when there is more than one', () => {
    expect(canSaveExpense({ ...ok, selectedAccountId: '' })).toBe(false);
  });

  it('does not need an account chosen when there is only one', () => {
    expect(canSaveExpense({ ...ok, accountCount: 1, selectedAccountId: '' })).toBe(true);
  });
});
