import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeFakeCardSupabase, FREE_HOUSEHOLD, type Row } from './fakeCardSupabase';

/**
 * PAST MONTHS ARE SNAPSHOT-ONLY (2026-09-11).
 *
 * A closed cycle shows what was saved FOR that month, or says nothing was —
 * never an earlier month's plan carried in. Open and future cycles keep the
 * carry-forward they always had.
 *
 * The fixture is the live shape that motivated this: Costco Lineu in the
 * founder's household has July category budgets (Groceries $650) and a July
 * goal, an AUGUST goal row but NO August category rows, and nothing at all
 * saved for a card like Costco Julia in some months.
 *
 * Covers both surfaces that render the picked month's goal on the same
 * screen — GET /api/card-envelope (decision view) and GET /api/cards/overview
 * (cross-card strip) — since they must agree.
 */

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const LINEU = 'card-costco-lineu';   // close 15 — has an Aug goal, no Aug categories
const JULIA = 'card-costco-julia';   // close 15 — July plan only, nothing after
const GROCERIES = 'cat-groceries';

function seed(): Record<string, Row[]> {
  return {
    users: [{ id: 'user-1', household_id: 'hh-1' }],
    households: [FREE_HOUSEHOLD],
    accounts: [
      { id: LINEU, household_id: 'hh-1', name: 'Costco Lineu', type: 'credit_card', statement_close_day: 15, payment_day: 5, sort_order: 1, created_at: '2026-07-15' },
      { id: JULIA, household_id: 'hh-1', name: 'Costco Julia', type: 'credit_card', statement_close_day: 15, payment_day: 5, sort_order: 2, created_at: '2026-07-15' },
    ],
    categories: [{ id: GROCERIES, household_id: 'hh-1', type: 'expense', name: 'Groceries & Pharmacy', name_fr: null }],
    monthly_goals: [
      { household_id: 'hh-1', account_id: LINEU, month: '2026-07-01', card_goal: 650 },
      { household_id: 'hh-1', account_id: LINEU, month: '2026-08-01', card_goal: 640 },
      { household_id: 'hh-1', account_id: JULIA, month: '2026-07-01', card_goal: 800 },
    ],
    card_envelope_items: [
      { household_id: 'hh-1', account_id: LINEU, category_id: GROCERIES, month: '2026-07-01', monthly_amount: 650 },
      { household_id: 'hh-1', account_id: JULIA, category_id: GROCERIES, month: '2026-07-01', monthly_amount: 600 },
    ],
    transactions: [
      // August cycle for close-15 cards is Jul 16 – Aug 15.
      { id: 't1', household_id: 'hh-1', account_id: LINEU, date: '2026-08-02', amount: 212.4, type: 'expense', category_id: GROCERIES, is_bridge: false, description: 'Costco', installment_label: null },
      { id: 't2', household_id: 'hh-1', account_id: JULIA, date: '2026-08-03', amount: 88, type: 'expense', category_id: GROCERIES, is_bridge: false, description: 'Costco', installment_label: null },
    ],
  };
}

async function getEnvelope(cardId: string, month: string) {
  const { client } = makeFakeCardSupabase(seed());
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const { GET } = await import('../route');
  const res = await GET(new Request(`http://localhost/api/card-envelope?cardId=${cardId}&month=${month}`));
  expect(res.status).toBe(200);
  return res.json();
}

async function getOverview(month: string) {
  const { client } = makeFakeCardSupabase(seed());
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const { GET } = await import('../../cards/overview/route');
  const res = await GET(new Request(`http://localhost/api/cards/overview?month=${month}`));
  expect(res.status).toBe(200);
  return (await res.json()).cards as { id: string; goal: number | null }[];
}

describe('GET /api/card-envelope — closed cycles show their own snapshot, never a carried one', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T12:00:00-04:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('goal saved but no categories (Costco Lineu, August): goalOnly, August\'s own goal, and NO July budget carried in', async () => {
    const d = await getEnvelope(LINEU, '2026-08');

    expect(d.cycleState).toBe('closed');
    expect(d.pastPlan).toBe('goalOnly');
    expect(d.totalGoal).toBe(640); // August's own row — not July's 650
    // Groceries still shows (real August spend), but with NO budget: July's
    // $650 must not appear against August.
    const groceries = d.envelopeItems.find((i: { categoryId: string }) => i.categoryId === GROCERIES);
    expect(groceries.actual).toBe(212.4);
    expect(groceries.monthlyAmount).toBe(0);
    expect(d.envelopeItems.some((i: { monthlyAmount: number }) => i.monthlyAmount === 650)).toBe(false);
  });

  it('nothing saved at all (Costco Julia, August): none, and no goal — July\'s $800 is NOT carried in', async () => {
    const d = await getEnvelope(JULIA, '2026-08');

    expect(d.cycleState).toBe('closed');
    expect(d.pastPlan).toBe('none');
    expect(d.totalGoal).toBeNull();
    expect(d.totalSpent).toBe(88); // actuals only
  });

  it('a closed month with its own saved plan reads as saved, with its own numbers', async () => {
    const d = await getEnvelope(LINEU, '2026-07');
    expect(d.pastPlan).toBe('saved');
    expect(d.totalGoal).toBe(650);
    expect(d.envelopeItems.find((i: { categoryId: string }) => i.categoryId === GROCERIES).monthlyAmount).toBe(650);
  });

  it('the OPEN cycle keeps carry-forward, unchanged (Julia, September: July\'s goal still applies)', async () => {
    const d = await getEnvelope(JULIA, '2026-09'); // Aug 16 – Sep 15: open on Sep 11
    expect(d.cycleState).toBe('open');
    expect(d.pastPlan).toBeNull();
    expect(d.totalGoal).toBe(800);
  });

  it('a failed goal read is a 500 — never shown as "no goal was saved for this month"', async () => {
    const { client } = makeFakeCardSupabase(seed(), { failTables: ['monthly_goals'] });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { GET } = await import('../route');
    const res = await GET(new Request(`http://localhost/api/card-envelope?cardId=${LINEU}&month=2026-08`));
    expect(res.status).toBe(500);
  });

  it('a FUTURE cycle keeps carry-forward, unchanged', async () => {
    const d = await getEnvelope(JULIA, '2026-11');
    expect(d.cycleState).toBe('future');
    expect(d.totalGoal).toBe(800);
  });
});

describe('GET /api/cards/overview — same goal rule as the decision view on the same screen', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T12:00:00-04:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('closed month: each card\'s own goal or null, never carried', async () => {
    const cards = await getOverview('2026-08');
    expect(cards.find((c) => c.id === LINEU)?.goal).toBe(640);
    expect(cards.find((c) => c.id === JULIA)?.goal).toBeNull();
  });

  it('open month: carried forward, unchanged', async () => {
    const cards = await getOverview('2026-09');
    expect(cards.find((c) => c.id === LINEU)?.goal).toBe(640);
    expect(cards.find((c) => c.id === JULIA)?.goal).toBe(800);
  });
});
