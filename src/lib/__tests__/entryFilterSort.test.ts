import { describe, it, expect } from 'vitest';
import {
  filterAndSortEntries,
  entryMatchesFilter,
  type CategoryEntryLine,
} from '../envelopeHelpers';

// The Cards page filter/sort. Built for one concrete need — "see all the
// Amazon rows together" — so the filter is the primary tool and sorting is
// secondary. These pin the ordering rules that would otherwise regress
// silently: nulls last, case-insensitive, ties broken by date, and the input
// array never reordered in place.

function entry(over: Partial<CategoryEntryLine> = {}): CategoryEntryLine {
  return {
    id: Math.random().toString(36).slice(2),
    date: '2026-07-15',
    description: 'Something',
    amount: 10,
    type: 'expense',
    installmentLabel: null,
    ...over,
  };
}

const AMAZON = entry({ id: 'a', description: 'AMAZON.CA', date: '2026-07-03', amount: 42.1 });
const AMAZON_2 = entry({ id: 'b', description: 'amazon prime', date: '2026-07-20', amount: 9.99 });
const COSTCO = entry({ id: 'c', description: 'Costco', date: '2026-07-10', amount: 300 });
const BLANK = entry({ id: 'd', description: null, date: '2026-07-01', amount: 5 });

describe('entryMatchesFilter', () => {
  it('matches case-insensitively on description', () => {
    expect(entryMatchesFilter(AMAZON, 'amazon')).toBe(true);
    expect(entryMatchesFilter(AMAZON, 'AMAZON')).toBe(true);
    expect(entryMatchesFilter(COSTCO, 'amazon')).toBe(false);
  });

  it('matches the installment label too', () => {
    const installment = entry({ description: 'TV', installmentLabel: '3 of 12' });
    expect(entryMatchesFilter(installment, '3 of')).toBe(true);
  });

  it('an empty or whitespace filter matches everything, including blank descriptions', () => {
    expect(entryMatchesFilter(BLANK, '')).toBe(true);
    expect(entryMatchesFilter(BLANK, '   ')).toBe(true);
  });

  it('a blank description never matches a real search term', () => {
    expect(entryMatchesFilter(BLANK, 'amazon')).toBe(false);
  });
});

describe('filterAndSortEntries', () => {
  const all = [AMAZON, AMAZON_2, COSTCO, BLANK];

  it('finds every Amazon row regardless of case — the actual request', () => {
    const found = filterAndSortEntries(all, 'amazon', 'date', 'asc');
    expect(found.map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('never mutates or reorders the caller array', () => {
    const original = [...all];
    filterAndSortEntries(all, '', 'amount', 'desc');
    expect(all).toEqual(original);
  });

  it('sorts by date in both directions', () => {
    expect(filterAndSortEntries(all, '', 'date', 'asc').map((e) => e.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(filterAndSortEntries(all, '', 'date', 'desc').map((e) => e.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('sorts by amount on magnitude, so an expense and income of equal size stay adjacent', () => {
    const income = entry({ id: 'inc', description: 'Refund', amount: -300, type: 'income' });
    const byAmount = filterAndSortEntries([COSTCO, income, BLANK], '', 'amount', 'desc');
    // 300 and -300 are the two largest by magnitude and land together.
    expect(byAmount.slice(0, 2).map((e) => e.id).sort()).toEqual(['c', 'inc']);
    expect(byAmount[2].id).toBe('d');
  });

  it('sorts by description case-insensitively', () => {
    expect(filterAndSortEntries([COSTCO, AMAZON], '', 'description', 'asc').map((e) => e.id))
      .toEqual(['a', 'c']);
  });

  // A blank is absence of data, not a value at one end of the range.
  it('keeps blank descriptions last in BOTH sort directions', () => {
    expect(filterAndSortEntries(all, '', 'description', 'asc').at(-1)!.id).toBe('d');
    expect(filterAndSortEntries(all, '', 'description', 'desc').at(-1)!.id).toBe('d');
  });

  it('breaks description ties by date so equal names keep a stable, meaningful order', () => {
    const first = entry({ id: 'x', description: 'Uber', date: '2026-07-02' });
    const second = entry({ id: 'y', description: 'uber', date: '2026-07-25' });
    expect(filterAndSortEntries([second, first], '', 'description', 'asc').map((e) => e.id))
      .toEqual(['x', 'y']);
  });

  it('returns an empty list when nothing matches, rather than falling back to everything', () => {
    expect(filterAndSortEntries(all, 'zzzz', 'date', 'asc')).toEqual([]);
  });
});
