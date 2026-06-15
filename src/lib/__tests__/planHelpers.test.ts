import { describe, it, expect } from 'vitest';
import { dedupeSinkingFunds } from '../planHelpers';

describe('dedupeSinkingFunds', () => {
  it('removes an expense category that matches a sinking fund', () => {
    const categories = [
      { name: 'Groceries', type: 'expense' },
      { name: 'Property tax', type: 'expense' },
    ];
    const sinkingFunds = [{ name: 'Property tax' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result).toEqual([{ name: 'Groceries', type: 'expense' }]);
  });

  it('always keeps income categories even if names collide', () => {
    const categories = [
      { name: 'Property tax', type: 'income' }, // contrived, but income is protected
    ];
    const sinkingFunds = [{ name: 'Property tax' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result).toHaveLength(1);
  });

  it('matches case-insensitively and ignores surrounding whitespace', () => {
    const categories = [
      { name: '  PROPERTY TAX  ', type: 'expense' },
      { name: 'Restaurants', type: 'expense' },
    ];
    const sinkingFunds = [{ name: 'property tax' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result.map((c) => c.name)).toEqual(['Restaurants']);
  });

  it('keeps everything when there are no sinking funds', () => {
    const categories = [
      { name: 'Groceries', type: 'expense' },
      { name: 'Salary', type: 'income' },
    ];
    const result = dedupeSinkingFunds(categories, []);
    expect(result).toHaveLength(2);
  });

  it('removes multiple matching categories', () => {
    const categories = [
      { name: 'Property tax', type: 'expense' },
      { name: 'Christmas', type: 'expense' },
      { name: 'Groceries', type: 'expense' },
    ];
    const sinkingFunds = [{ name: 'Property tax' }, { name: 'Christmas' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result.map((c) => c.name)).toEqual(['Groceries']);
  });

  it('preserves the budgeted field on kept categories', () => {
    const categories = [
      { name: 'Groceries', type: 'expense', budgeted: 600 },
      { name: 'Property tax', type: 'expense', budgeted: 350 },
    ];
    const sinkingFunds = [{ name: 'Property tax' }];
    const result = dedupeSinkingFunds(categories, sinkingFunds);
    expect(result).toEqual([{ name: 'Groceries', type: 'expense', budgeted: 600 }]);
  });
});