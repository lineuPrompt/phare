import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeFakeCardSupabase, FREE_HOUSEHOLD, PRO_HOUSEHOLD, type Row } from './fakeCardSupabase';
import { totalSpendForCard, type EnvTx } from '@/lib/envelopeHelpers';

/**
 * THE $0 TRAP (found in diagnosis, 2026-09-11).
 *
 * buildGrid gives every non-future column a real number. Until this change
 * the grid route fetched transactions for only the current + next cycle, which
 * was safe while the grid had no past columns. Add a past column without
 * widening that fetch and the column reads $0 — a plausible, wrong figure,
 * with no error anywhere.
 *
 * The fake here honours gte/lte, so a too-narrow fetch really does return too
 * few rows. The core assertion compares every non-future column with
 * totalSpendForCard computed over the WHOLE ledger — independently of
 * whatever range the route chose to ask for.
 */

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const VISA = 'card-visa'; // closes the 27th, like the founder's Visa Avion
const GROCERIES = 'cat-groceries';

function tx(id: string, date: string, amount: number, category: string | null = GROCERIES): Row {
  return { id, household_id: 'hh-1', account_id: VISA, date, amount, type: 'expense', category_id: category, is_bridge: false };
}

// July cycle = Jun 28 – Jul 27; August = Jul 28 – Aug 27; September = Aug 28 – Sep 27.
const LEDGER: Row[] = [
  tx('j1', '2026-06-29', 40),        // June date, JULY cycle
  tx('j2', '2026-07-05', 100),
  tx('j3', '2026-07-27', 60, null),  // close date, uncategorized
  tx('a1', '2026-07-28', 25),        // first day of August's cycle
  tx('a2', '2026-08-20', 300),
  tx('s1', '2026-09-02', 75),
];

function seed(household: Row): Record<string, Row[]> {
  return {
    users: [{ id: 'user-1', household_id: 'hh-1' }],
    households: [household],
    accounts: [{ id: VISA, household_id: 'hh-1', name: 'Visa', type: 'credit_card', statement_close_day: 27 }],
    categories: [{ id: GROCERIES, household_id: 'hh-1', type: 'expense', name: 'Groceries & Pharmacy', name_fr: null }],
    monthly_goals: [{ household_id: 'hh-1', account_id: VISA, month: '2026-07-01', card_goal: 3000 }],
    card_envelope_items: [{ household_id: 'hh-1', account_id: VISA, category_id: GROCERIES, month: '2026-07-01', monthly_amount: 650 }],
    transactions: LEDGER,
  };
}

async function getGrid(household: Row, query: string) {
  const { client } = makeFakeCardSupabase(seed(household));
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const { GET } = await import('../grid/route');
  const res = await GET(new Request(`http://localhost/api/card-envelope/grid?cardId=${VISA}${query}`));
  expect(res.status).toBe(200);
  return res.json();
}

describe('GET /api/card-envelope/grid — past months', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T12:00:00-04:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('THE REGRESSION: a past column shows the real actual, never a wrong $0', async () => {
    const grid = await getGrid(PRO_HOUSEHOLD, '&month=2026-07');

    expect(grid.months[0]).toBe('2026-07');
    expect(grid.cycleStates[0]).toBe('closed');
    // July's cycle holds 40 + 100 + 60 = 200. The old fetch would give 0.
    expect(grid.totalActuals[0]).toBe(200);
    expect(grid.totalActuals[1]).toBe(325); // August: 25 + 300
  });

  it('every non-future column equals totalSpendForCard over the WHOLE ledger', async () => {
    const grid = await getGrid(PRO_HOUSEHOLD, '&month=2026-07');
    const ledger = LEDGER as unknown as EnvTx[];
    grid.months.forEach((m: string, i: number) => {
      if (grid.cycleStates[i] === 'future') {
        expect(grid.totalActuals[i]).toBeNull();
      } else {
        expect(grid.totalActuals[i]).toBe(totalSpendForCard(ledger, VISA, m, 27));
      }
    });
  });

  it('past picked: 12 columns starting AT the picked month (Pro)', async () => {
    const grid = await getGrid(PRO_HOUSEHOLD, '&month=2026-07');
    expect(grid.months).toHaveLength(12);
    expect(grid.months[0]).toBe('2026-07');
    expect(grid.months[11]).toBe('2027-06');
  });

  it('current or future picked: today\'s forward window, unchanged (Pro: Sep 2026 – Aug 2027)', async () => {
    for (const q of ['', '&month=2026-09', '&month=2027-02']) {
      vi.resetModules();
      const grid = await getGrid(PRO_HOUSEHOLD, q);
      expect(grid.months[0]).toBe('2026-09');
      expect(grid.months).toHaveLength(12);
      expect(grid.months[11]).toBe('2027-08');
    }
  });

  it('free household: the grid never runs past the free horizon, even from a past start', async () => {
    const forward = await getGrid(FREE_HOUSEHOLD, '');
    expect(forward.months).toEqual(['2026-09', '2026-10', '2026-11']);

    vi.resetModules();
    const fromJuly = await getGrid(FREE_HOUSEHOLD, '&month=2026-07');
    expect(fromJuly.months).toEqual(['2026-07', '2026-08', '2026-09', '2026-10', '2026-11']);
  });

  it('closed columns use their own snapshot: August shows no plan, not July\'s carried $3,000 / $650', async () => {
    const grid = await getGrid(PRO_HOUSEHOLD, '&month=2026-07');
    const groceries = grid.rows.find((r: { categoryId: string }) => r.categoryId === GROCERIES);
    expect(grid.pastPlans[0]).toBe('saved');
    expect(groceries.budgets[0]).toBe(650);
    expect(grid.totalGoals[0]).toBe(3000);
    expect(grid.pastPlans[1]).toBe('none');
    expect(groceries.budgets[1]).toBe(0);
    expect(grid.totalGoals[1]).toBeNull();
    // The open (September) column still carries July's plan forward.
    expect(grid.cycleStates[2]).toBe('open');
    expect(groceries.budgets[2]).toBe(650);
    expect(grid.totalGoals[2]).toBe(3000);
  });

  it('rejects a malformed month', async () => {
    const { client } = makeFakeCardSupabase(seed(PRO_HOUSEHOLD));
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { GET } = await import('../grid/route');
    const res = await GET(new Request(`http://localhost/api/card-envelope/grid?cardId=${VISA}&month=2026-7`));
    expect(res.status).toBe(400);
  });

  it('a failed transactions read is a 500, not a grid of real-looking $0 actuals', async () => {
    const { client } = makeFakeCardSupabase(seed(PRO_HOUSEHOLD), { failTables: ['transactions'] });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { GET } = await import('../grid/route');
    const res = await GET(new Request(`http://localhost/api/card-envelope/grid?cardId=${VISA}&month=2026-07`));
    expect(res.status).toBe(500);
  });
});
