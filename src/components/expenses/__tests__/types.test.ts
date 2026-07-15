import { describe, it, expect } from 'vitest';
import { formatSignedAmount } from '../types';

// Regression coverage for the 2026-07-15 bug: a refund and an expense
// rendered identically in mixed transaction lists (card entries, expenses
// page) once refunds started appearing alongside expenses in the same list.

describe('formatSignedAmount', () => {
  it('income gets a leading + and green', () => {
    const { text, color } = formatSignedAmount(200, 'income', 'en');
    expect(text).toBe('+$200.00');
    expect(color).toBe('#16A34A');
  });

  it('expense has no sign and the default text color', () => {
    const { text, color } = formatSignedAmount(500, 'expense', 'en');
    expect(text).toBe('$500.00');
    expect(color).toBe('#0F2044');
  });

  it('a negative amount is shown by absolute value with the type\'s sign, not a double negative', () => {
    // e.g. an edit form storing a signed value — the type, not the sign of
    // the number, decides whether a + is shown.
    expect(formatSignedAmount(-50, 'income', 'en').text).toBe('+$50.00');
    expect(formatSignedAmount(-50, 'expense', 'en').text).toBe('$50.00');
  });

  it('is locale-safe: the + sign is literal, not part of Intl formatting', () => {
    const fr = formatSignedAmount(200, 'income', 'fr');
    expect(fr.text.startsWith('+')).toBe(true);
    expect(fr.color).toBe('#16A34A');
  });

  it('income and expense of the same amount render distinguishably', () => {
    const income = formatSignedAmount(300, 'income', 'en');
    const expense = formatSignedAmount(300, 'expense', 'en');
    expect(income.text).not.toBe(expense.text);
    expect(income.color).not.toBe(expense.color);
  });
});
