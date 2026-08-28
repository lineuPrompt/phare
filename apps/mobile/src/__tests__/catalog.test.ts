import { describe, it, expect } from 'vitest';
import { flattenKeys, interpolate, lookup, makeTranslator, type Catalog } from '../i18n/catalog';

const CATALOG: Catalog = {
  common: { retry: 'Try again' },
  review: { locked: 'Not included.', greeting: 'Hello {name}, you have {count} letters' },
};

describe('lookup', () => {
  it('resolves a nested dot path to its string', () => {
    expect(lookup(CATALOG, 'common.retry')).toBe('Try again');
  });

  it('returns null for a missing path rather than throwing', () => {
    expect(lookup(CATALOG, 'common.nope')).toBeNull();
    expect(lookup(CATALOG, 'nope.at.all')).toBeNull();
  });

  it('returns null when the path lands on a branch, not a leaf', () => {
    // 'common' is an object. Rendering "[object Object]" into the UI is the
    // failure this prevents.
    expect(lookup(CATALOG, 'common')).toBeNull();
  });

  it('does not fall through to Object.prototype', () => {
    // Without a typeof check, 'common.constructor' resolves to a function and
    // 'toString' to a method — a key like that must be absent, not inherited.
    expect(lookup(CATALOG, 'common.constructor')).toBeNull();
    expect(lookup(CATALOG, 'toString')).toBeNull();
  });
});

describe('interpolate', () => {
  it('substitutes named placeholders', () => {
    expect(interpolate('Hello {name}', { name: 'Marie' })).toBe('Hello Marie');
  });

  it('substitutes numbers', () => {
    expect(interpolate('{count} letters', { count: 3 })).toBe('3 letters');
  });

  it('leaves an unmatched placeholder visible rather than blanking it', () => {
    // A visible {amount} is a bug report; a silent gap in a sentence about
    // money is not.
    expect(interpolate('You saved {amount}', { other: 1 })).toBe('You saved {amount}');
  });

  it('returns the template untouched when no values are given', () => {
    expect(interpolate('Nothing to fill')).toBe('Nothing to fill');
  });

  it('substitutes every occurrence of the same placeholder', () => {
    expect(interpolate('{a} and {a}', { a: 'x' })).toBe('x and x');
  });
});

describe('makeTranslator', () => {
  const t = makeTranslator(CATALOG);

  it('translates and interpolates in one call', () => {
    expect(t('review.greeting', { name: 'Ana', count: 2 })).toBe(
      'Hello Ana, you have 2 letters'
    );
  });

  it('falls back to the key itself when it is missing', () => {
    // Visible on screen, and caught by the parity test before it ships.
    expect(t('review.absent')).toBe('review.absent');
  });
});

describe('flattenKeys', () => {
  it('returns every leaf path, sorted', () => {
    expect(flattenKeys(CATALOG)).toEqual([
      'common.retry',
      'review.greeting',
      'review.locked',
    ]);
  });

  it('ignores branches, counting only leaves', () => {
    expect(flattenKeys({ a: { b: { c: 'x' } } })).toEqual(['a.b.c']);
  });
});
