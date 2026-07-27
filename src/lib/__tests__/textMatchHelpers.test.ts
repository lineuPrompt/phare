import { describe, it, expect } from 'vitest';
import { escapeRegExp } from '../textMatchHelpers';

describe('escapeRegExp', () => {
  it('escapes regex special characters so a literal string can be used in a RegExp', () => {
    const raw = 'Groceries & Pharmacy';
    const re = new RegExp(`\\b${escapeRegExp(raw)}\\b`, 'i');
    expect(re.test('your Groceries & Pharmacy spend')).toBe(true);
  });

  it('escapes parentheses, brackets, and other special chars literally', () => {
    const raw = '(test) [value]';
    const re = new RegExp(escapeRegExp(raw));
    expect(re.test('a (test) [value] appeared')).toBe(true);
    expect(re.test('a test value appeared')).toBe(false);
  });
});
