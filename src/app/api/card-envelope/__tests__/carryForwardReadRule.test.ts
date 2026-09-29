import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeFakeCardSupabase, FREE_HOUSEHOLD, type Row } from './fakeCardSupabase';
import { editorItemsFrom, planForMonth } from '@/lib/envelopeHelpers';

/**
 * ONE READ RULE FOR OPEN AND FUTURE MONTHS (2026-09-29).
 *
 * Before this, an open month with no plan of its own showed a carried-forward
 * goal in the decision view over an EMPTY category list (the category rows
 * read the exact month only), while the grid showed the carried categories
 * for the same month. Opening the editor there and pressing Save wrote the
 * month with no category budgets, and that empty plan then carried forward.
 *
 * The fake honours eq / lte, so a route still reading the exact month really
 * does get no rows.
 */

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const CARD = 'card-master';          // close 15, like Zezinho Test's MASTER
const GROCERIES = 'cat-groceries';
const RESTAURANTS = 'cat-restaurants';
const SHOPPING = 'cat-shopping';

function seed(): Record<string, Row[]> {
  return {
    users: [{ id: 'user-1', household_id: 'hh-1' }],
    households: [FREE_HOUSEHOLD],
    accounts: [{ id: CARD, household_id: 'hh-1', name: 'MASTER', type: 'credit_card', statement_close_day: 15, payment_day: 5, sort_order: 1, created_at: '2026-07-15' }],
    categories: [
      { id: GROCERIES, household_id: 'hh-1', type: 'expense', name: 'Groceries & Pharmacy', name_fr: null },
      { id: RESTAURANTS, household_id: 'hh-1', type: 'expense', name: 'Restaurants', name_fr: null },
      { id: SHOPPING, household_id: 'hh-1', type: 'expense', name: 'Shopping', name_fr: null },
    ],
    // Stored newest-month-first on purpose: the rule is "nearest month at or
    // before", and must not depend on row order.
    monthly_goals: [
      { household_id: 'hh-1', account_id: CARD, month: '2026-08-01', card_goal: 900 },
      { household_id: 'hh-1', account_id: CARD, month: '2026-07-01', card_goal: 700 },
    ],
    card_envelope_items: [
      { household_id: 'hh-1', account_id: CARD, category_id: GROCERIES, month: '2026-08-01', monthly_amount: 500 },
      { household_id: 'hh-1', account_id: CARD, category_id: RESTAURANTS, month: '2026-08-01', monthly_amount: 150 },
      { household_id: 'hh-1', account_id: CARD, category_id: GROCERIES, month: '2026-07-01', monthly_amount: 400 },
    ],
    transactions: [
      // October cycle for a close-15 card is Sep 16 – Oct 15; open on Sep 29.
      { id: 't1', household_id: 'hh-1', account_id: CARD, date: '2026-09-20', amount: 80, type: 'expense', category_id: GROCERIES, is_bridge: false, description: 'IGA', installment_label: null },
      { id: 't2', household_id: 'hh-1', account_id: CARD, date: '2026-09-21', amount: 45, type: 'expense', category_id: SHOPPING, is_bridge: false, description: 'Winners', installment_label: null },
    ],
  };
}

async function getEnvelope(month: string, failTables: string[] = []) {
  const { client } = makeFakeCardSupabase(seed(), { failTables });
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const { GET } = await import('../route');
  return GET(new Request(`http://localhost/api/card-envelope?cardId=${CARD}&month=${month}`));
}

async function getGrid(month: string) {
  const { client } = makeFakeCardSupabase(seed());
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const { GET } = await import('../grid/route');
  const res = await GET(new Request(`http://localhost/api/card-envelope/grid?cardId=${CARD}&month=${month}`));
  expect(res.status).toBe(200);
  return res.json();
}

type Item = { categoryId: string; monthlyAmount: number; planned: boolean };

describe('GET /api/card-envelope — open and future months carry the plan forward, categories included', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00-04:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('an OPEN month with no plan of its own shows August\'s category budgets, not an empty list', async () => {
    const res = await getEnvelope('2026-10');
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.cycleState).toBe('open');
    expect(d.totalGoal).toBe(900);
    const planned = (d.envelopeItems as Item[]).filter((i) => i.planned);
    expect(planned.map((i) => [i.categoryId, i.monthlyAmount]).sort()).toEqual([[GROCERIES, 500], [RESTAURANTS, 150]]);
  });

  it('a FUTURE month with no plan of its own carries the same plan', async () => {
    const d = await (await getEnvelope('2026-12')).json();
    expect(d.cycleState).toBe('future');
    expect(d.totalGoal).toBe(900);
    expect((d.envelopeItems as Item[]).filter((i) => i.planned).map((i) => i.monthlyAmount).sort()).toEqual([150, 500]);
  });

  it('the decision view and the grid show the SAME budgets for the same open month', async () => {
    const d = await (await getEnvelope('2026-10')).json();
    const grid = await getGrid('2026-10');
    const col = grid.months.indexOf('2026-10');
    expect(col).toBeGreaterThanOrEqual(0);
    expect(grid.totalGoals[col]).toBe(d.totalGoal);
    for (const item of (d.envelopeItems as Item[]).filter((i) => i.planned)) {
      const row = grid.rows.find((r: { categoryId: string }) => r.categoryId === item.categoryId);
      expect(row.budgets[col]).toBe(item.monthlyAmount);
    }
  });

  it('spend in a category the plan does not budget is shown, marked planned: false', async () => {
    const d = await (await getEnvelope('2026-10')).json();
    const shopping = (d.envelopeItems as Item[]).find((i) => i.categoryId === SHOPPING)!;
    expect(shopping).toMatchObject({ monthlyAmount: 0, planned: false });
  });

  it('a CLOSED month with no plan of its own still shows nothing carried in', async () => {
    const d = await (await getEnvelope('2026-09')).json(); // Aug 16 – Sep 15: closed on Sep 29
    expect(d.cycleState).toBe('closed');
    expect(d.totalGoal).toBeNull();
    expect((d.envelopeItems as Item[]).filter((i) => i.planned)).toEqual([]);
  });

  it('a failed category-budget read is a 500 — never shown as "no categories planned"', async () => {
    const res = await getEnvelope('2026-10', ['card_envelope_items']);
    expect(res.status).toBe(500);
  });
});

describe('editorItemsFrom — the editor starts from the plan being shown', () => {
  it('keeps the planned rows (own or carried) with their amounts, and drops spend-only rows', () => {
    const shown = [
      { categoryId: GROCERIES, categoryName: 'Groceries', monthlyAmount: 500, planned: true },
      { categoryId: SHOPPING, categoryName: 'Shopping', monthlyAmount: 0, planned: false },
      { categoryId: RESTAURANTS, categoryName: 'Restaurants', monthlyAmount: 0, planned: true }, // a saved $0 budget is still the plan
    ];
    expect(editorItemsFrom(shown)).toEqual([
      { categoryId: GROCERIES, categoryName: 'Groceries', monthlyAmount: 500 },
      { categoryId: RESTAURANTS, categoryName: 'Restaurants', monthlyAmount: 0 },
    ]);
  });
});

describe('planForMonth — the one read rule', () => {
  const goals = new Map([['2026-08', 900], ['2026-07', 700], ['2026-11', 1200]]);
  const items = new Map([['2026-07', ['july']], ['2026-08', ['august']]]);

  it('closed: the month\'s own snapshot only', () => {
    expect(planForMonth(goals, items, '2026-08', true)).toEqual({ goal: 900, items: ['august'] });
    expect(planForMonth(goals, items, '2026-09', true)).toEqual({ goal: null, items: [] });
  });

  it('open/future: nearest month at or before, by month — a later month\'s plan wins whatever order it was stored in', () => {
    expect(planForMonth(goals, items, '2026-10', false)).toEqual({ goal: 900, items: ['august'] });
    expect(planForMonth(goals, items, '2026-12', false)).toEqual({ goal: 1200, items: ['august'] });
    expect(planForMonth(goals, items, '2026-06', false)).toEqual({ goal: null, items: [] });
  });
});
