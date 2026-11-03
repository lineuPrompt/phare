import { describe, it, expect } from 'vitest';
import { categoryTrends, balanceProgress, previousRecommendation, type TrendTx } from '@/lib/reviewTrends';

const CHQ = 'chq';
const CARD = 'card';
const months = ['2026-07', '2026-08', '2026-09', '2026-10'].map((m) => ({ month: m, name: m }));
const names = new Map([['food', 'Groceries'], ['fun', 'Restaurants'], ['car', 'Car']]);
const chq = (date: string, amount: number, category_id: string | null = 'food'): TrendTx =>
  ({ account_id: CHQ, amount, type: 'expense', date, category_id, is_bridge: false });

function trends(rows: TrendTx[], today = '2026-11-01', monthInProgress = false) {
  return categoryTrends({ rows, chequingIds: [CHQ], cards: [{ id: CARD, closeDay: 15 }], categoryNames: names, months, today, monthInProgress });
}

describe('categoryTrends', () => {
  it('per category, real months only: change, biggest increase and decrease', () => {
    const t = trends([
      chq('2026-09-05', 500), chq('2026-10-05', 650),
      chq('2026-09-06', 300, 'fun'), chq('2026-10-06', 100, 'fun'),
    ])!;
    // July and August had no spending: left out, never $0.
    expect(t.months.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(t.categories.find((c) => c.name === 'Groceries')).toEqual({
      name: 'Groceries', amounts: [{ month: '2026-09', amount: 500 }, { month: '2026-10', amount: 650 }],
      thisMonth: 650, lastMonth: 500, changeVsLastMonth: 150,
    });
    expect(t.biggestIncrease).toEqual({ name: 'Groceries', change: 150 });
    expect(t.biggestDecrease).toEqual({ name: 'Restaurants', change: -200 });
  });

  it('a card category by statement cycle, refunds netted, bridge rows never counted', () => {
    const t = trends([
      chq('2026-09-05', 100), chq('2026-10-05', 100),
      // Card closes on the 15th: Sep 20 belongs to the October cycle.
      { account_id: CARD, amount: 80, type: 'expense', date: '2026-09-20', category_id: 'car', is_bridge: false },
      { account_id: CARD, amount: 30, type: 'income', date: '2026-10-02', category_id: 'car', is_bridge: false },
      { account_id: CHQ, amount: 999, type: 'expense', date: '2026-10-10', category_id: 'food', is_bridge: true },
    ])!;
    expect(t.categories.find((c) => c.name === 'Car')).toMatchObject({ thisMonth: 50, lastMonth: 0 });
    expect(t.categories.find((c) => c.name === 'Groceries')).toMatchObject({ thisMonth: 100 });
  });

  it('highest and lowest of three months or more', () => {
    const t = trends([
      chq('2026-08-05', 300), chq('2026-09-05', 400), chq('2026-10-05', 500),
      chq('2026-08-06', 300, 'fun'), chq('2026-09-06', 200, 'fun'), chq('2026-10-06', 100, 'fun'),
    ])!;
    expect(t.categories.find((c) => c.name === 'Groceries')!.highestOfMonths).toBe(true);
    expect(t.categories.find((c) => c.name === 'Restaurants')!.lowestOfMonths).toBe(true);
    expect(t.categories.find((c) => c.name === 'Groceries')!.lowestOfMonths).toBeUndefined();
  });

  it('a month in progress: rows after today never count, and nothing is compared', () => {
    const t = trends([chq('2026-09-05', 500), chq('2026-10-02', 40), chq('2026-10-20', 900)], '2026-10-10', true)!;
    const g = t.categories.find((c) => c.name === 'Groceries')!;
    expect(g.thisMonth).toBe(40);
    expect(g).not.toHaveProperty('changeVsLastMonth');
    expect(t).not.toHaveProperty('biggestIncrease');
    expect(t).not.toHaveProperty('biggestDecrease');
  });

  it('null with no earlier month, or no spending in the reviewed month', () => {
    expect(trends([chq('2026-10-05', 500)])).toBeNull();
    expect(trends([chq('2026-09-05', 500)])).toBeNull();
  });
});

describe('balanceProgress', () => {
  const rows = [
    { account_id: 'g', type: 'transfer', amount: 100, date: '2026-08-10' },
    { account_id: 'g', type: 'transfer', amount: 100, date: '2026-09-10' },
    { account_id: 'g', type: 'expense', amount: 50, date: '2026-10-10' },
    { account_id: 'g', type: 'transfer', amount: 999, date: '2026-10-25' },
  ];
  it('the balance at each month end from the first row\'s month, today for the running month', () => {
    expect(balanceProgress({ rows, accountId: 'g', name: 'Trip', kind: 'goal', months, today: '2026-10-20' })).toEqual({
      name: 'Trip', kind: 'goal', change: 50,
      balances: [{ month: '2026-08', balance: 100 }, { month: '2026-09', balance: 200 }, { month: '2026-10', balance: 150 }],
    });
  });
  it('null with fewer than two months', () => {
    expect(balanceProgress({ rows: rows.slice(2, 3), accountId: 'g', name: 'Trip', kind: 'goal', months, today: '2026-10-20' })).toBeNull();
  });
});

describe('previousRecommendation', () => {
  const letter = (text: string) => [{ type: 'top_recommendation', content: text }, { type: 'monthly_review', content: 'x' }];
  it('the month-end letter\'s over a later refresh, with its figures as numbers', () => {
    expect(previousRecommendation([
      { generated_by: 'manual', created_at: '2026-10-20', messages: letter('Refresh: $5.') },
      { generated_by: 'cron', created_at: '2026-10-01', messages: letter('Put $1,250.50 toward Trip.') },
    ], 'September 2026')).toEqual({ month: 'September 2026', text: 'Put $1,250.50 toward Trip.', figures: [1250.5] });
  });
  it('the latest refresh when there is no month-end letter; null when none has one', () => {
    expect(previousRecommendation([
      { generated_by: 'manual', created_at: '2026-10-05', messages: letter('Old.') },
      { generated_by: 'manual', created_at: '2026-10-20', messages: letter('New.') },
    ], 'm')!.text).toBe('New.');
    expect(previousRecommendation([{ generated_by: 'cron', created_at: '2026-10-01', messages: [] }], 'm')).toBeNull();
  });
});
