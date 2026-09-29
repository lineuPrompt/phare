import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeFakeCardSupabase, FREE_HOUSEHOLD, type Row } from './fakeCardSupabase';
import { editorItemsFrom } from '@/lib/envelopeHelpers';
import { fetchLaterOwnPlanMonths } from '@/lib/cardPlanServer';

/**
 * THE SAVE RULE (2026-09-29).
 *
 * Plans resolve by month order: a later open/future month with a plan of its
 * own outranks the month being edited, so an edit never reaches it. That is
 * how the founder's Visa Avion kept showing Groceries $550 for Nov/Dec after
 * a newer $200 decision.
 *
 * Saving now asks when such later plans exist. The household must answer;
 * 'apply' removes those later plans (goal and categories) so the saved month
 * carries into them, 'keep' leaves them. Closed months are never touched.
 *
 * Today is Sep 29 2026 and the card closes on the 15th: August and September
 * are closed, October is open, November onward is future.
 */

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const CARD = 'card-master';
const GROCERIES = 'cat-groceries';
const RESTAURANTS = 'cat-restaurants';

const goal = (month: string, card_goal: number): Row => ({ household_id: 'hh-1', account_id: CARD, month: `${month}-01`, card_goal });
const item = (month: string, category_id: string, monthly_amount: number): Row =>
  ({ household_id: 'hh-1', account_id: CARD, category_id, month: `${month}-01`, monthly_amount });

function seed(withLaterPlans = true): Record<string, Row[]> {
  return {
    users: [{ id: 'user-1', household_id: 'hh-1' }],
    households: [FREE_HOUSEHOLD],
    accounts: [{ id: CARD, household_id: 'hh-1', name: 'MASTER', type: 'credit_card', statement_close_day: 15, payment_day: 5, sort_order: 1, created_at: '2026-07-15' }],
    categories: [
      { id: GROCERIES, household_id: 'hh-1', type: 'expense', name: 'Groceries & Pharmacy', name_fr: null },
      { id: RESTAURANTS, household_id: 'hh-1', type: 'expense', name: 'Restaurants', name_fr: null },
    ],
    monthly_goals: [
      goal('2026-08', 900),                                           // closed
      ...(withLaterPlans ? [goal('2026-11', 1200), goal('2026-12', 1300)] : []),
    ],
    card_envelope_items: [
      item('2026-08', GROCERIES, 500), item('2026-08', RESTAURANTS, 150), // closed
      ...(withLaterPlans ? [item('2026-11', GROCERIES, 700), item('2026-12', GROCERIES, 800), item('2026-12', RESTAURANTS, 50)] : []),
    ],
    transactions: [],
  };
}

async function loadRoute(client: unknown) {
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  return import('../route');
}

async function post(client: unknown, body: Record<string, unknown>) {
  const { POST } = await loadRoute(client);
  return POST(new Request('http://localhost/api/card-envelope', { method: 'POST', body: JSON.stringify(body) }));
}

async function get(client: unknown, month: string) {
  const { GET } = await loadRoute(client);
  const res = await GET(new Request(`http://localhost/api/card-envelope?cardId=${CARD}&month=${month}`));
  expect(res.status).toBe(200);
  return res.json();
}

const saveOctober = (extra: Record<string, unknown> = {}) => ({
  cardId: CARD, month: '2026-10', totalGoal: 950,
  items: [{ categoryId: GROCERIES, monthlyAmount: 200 }],
  ...extra,
});

const monthsOf = (rows: Row[]) => [...new Set(rows.map((r) => String(r.month).slice(0, 7)))].sort();
const closedAugust = (store: Record<string, Row[]>) => ({
  goals: store.monthly_goals.filter((r) => r.month === '2026-08-01'),
  items: store.card_envelope_items.filter((r) => r.month === '2026-08-01'),
});
const AUGUST_AS_SEEDED = { goals: [goal('2026-08', 900)], items: [item('2026-08', GROCERIES, 500), item('2026-08', RESTAURANTS, 150)] };

describe('POST /api/card-envelope — later months with their own plans', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00-04:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('GET tells the editor which later months have their own plan', async () => {
    const { client } = makeFakeCardSupabase(seed());
    expect((await get(client, '2026-10')).laterPlanMonths).toEqual(['2026-11', '2026-12']);
    expect((await get(client, '2026-11')).laterPlanMonths).toEqual(['2026-12']);
    expect((await get(client, '2026-12')).laterPlanMonths).toEqual([]);
    expect((await get(client, '2026-09')).laterPlanMonths).toEqual([]); // closed: not editable, nothing to ask
  });

  it('no answer: 409 naming the months, and NOTHING is written', async () => {
    const { client, writes } = makeFakeCardSupabase(seed());
    const res = await post(client, saveOctober());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('later_plans_decision_required');
    expect(body.laterPlanMonths).toEqual(['2026-11', '2026-12']);
    expect(writes).toEqual([]);
  });

  it('"keep": October is saved, November and December keep their own plans, August untouched', async () => {
    const { client, store } = makeFakeCardSupabase(seed());
    const res = await post(client, saveOctober({ laterPlans: 'keep', laterPlanMonths: ['2026-11', '2026-12'] }));
    expect(res.status).toBe(200);
    expect((await res.json()).laterPlansRemoved).toBe(0);
    expect(monthsOf(store.monthly_goals)).toEqual(['2026-08', '2026-10', '2026-11', '2026-12']);
    expect(store.card_envelope_items.filter((r) => r.month === '2026-12-01')).toHaveLength(2);
    expect(closedAugust(store)).toEqual(AUGUST_AS_SEEDED);
    expect((await get(client, '2026-12')).totalGoal).toBe(1300);
  });

  it('"apply": November and December\'s own plans are removed and October carries into them; August untouched', async () => {
    const { client, store } = makeFakeCardSupabase(seed());
    const res = await post(client, saveOctober({ laterPlans: 'apply', laterPlanMonths: ['2026-12', '2026-11'] }));
    expect(res.status).toBe(200);
    expect((await res.json()).laterPlansRemoved).toBe(2);
    expect(monthsOf(store.monthly_goals)).toEqual(['2026-08', '2026-10']);
    expect(monthsOf(store.card_envelope_items)).toEqual(['2026-08', '2026-10']);
    expect(closedAugust(store)).toEqual(AUGUST_AS_SEEDED);

    const december = await get(client, '2026-12');
    expect(december.totalGoal).toBe(950);
    expect(december.envelopeItems.filter((i: { planned: boolean }) => i.planned)
      .map((i: { categoryId: string; monthlyAmount: number }) => [i.categoryId, i.monthlyAmount])).toEqual([[GROCERIES, 200]]);
  });

  it('an answer about a different set of months (stale page) is refused, writing nothing', async () => {
    const { client, writes } = makeFakeCardSupabase(seed());
    const res = await post(client, saveOctober({ laterPlans: 'apply', laterPlanMonths: ['2026-11'] }));
    expect(res.status).toBe(409);
    expect((await res.json()).laterPlanMonths).toEqual(['2026-11', '2026-12']);
    expect(writes).toEqual([]);
  });

  it('an answer that is neither apply nor keep is a 400, writing nothing', async () => {
    const { client, writes } = makeFakeCardSupabase(seed());
    const res = await post(client, saveOctober({ laterPlans: 'yes', laterPlanMonths: ['2026-11', '2026-12'] }));
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it('an answer without the months it was about is a 400, writing nothing', async () => {
    const { client, writes } = makeFakeCardSupabase(seed());
    const res = await post(client, saveOctober({ laterPlans: 'apply' }));
    expect(res.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it('the last month with a plan needs no answer', async () => {
    const { client } = makeFakeCardSupabase(seed());
    const res = await post(client, { cardId: CARD, month: '2026-12', totalGoal: 1000, items: [] });
    expect(res.status).toBe(200);
  });

  it('a failed removal says October saved and the later plans remain — never a bare saved:true', async () => {
    const { client, store } = makeFakeCardSupabase(seed(), { failDeleteTables: ['monthly_goals'] });
    const res = await post(client, saveOctober({ laterPlans: 'apply', laterPlanMonths: ['2026-11', '2026-12'] }));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe('later_plans_remove_failed');
    expect(body.saved).toBeUndefined();
    expect(monthsOf(store.monthly_goals)).toEqual(['2026-08', '2026-10', '2026-11', '2026-12']);
  });

  it('a failed read of later plans is a 500 before any write — the question is never skipped', async () => {
    const { client, writes } = makeFakeCardSupabase(seed(), { failTables: ['monthly_goals'] });
    const res = await post(client, saveOctober());
    expect(res.status).toBe(500);
    expect(writes).toEqual([]);
  });
});

describe('saving a month that was showing a carried plan writes it back unchanged', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T12:00:00-04:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('October (carried from August) → open the editor → Save untouched → October\'s own plan equals August\'s', async () => {
    const { client, store } = makeFakeCardSupabase(seed(false));
    const shown = await get(client, '2026-10');
    const editorItems = editorItemsFrom(shown.envelopeItems);

    const res = await post(client, {
      cardId: CARD, month: '2026-10', totalGoal: shown.totalGoal,
      items: editorItems.map((i) => ({ categoryId: i.categoryId, monthlyAmount: i.monthlyAmount })),
    });
    expect(res.status).toBe(200);

    const october = store.card_envelope_items
      .filter((r) => r.month === '2026-10-01')
      .map((r) => [r.category_id, r.monthly_amount]).sort();
    expect(october).toEqual([[GROCERIES, 500], [RESTAURANTS, 150]]);
    expect(store.monthly_goals.find((r) => r.month === '2026-10-01')?.card_goal).toBe(900);
    expect(closedAugust(store)).toEqual(AUGUST_AS_SEEDED);
  });
});

describe('fetchLaterOwnPlanMonths never lists a closed month', () => {
  it('from a closed July, only the open and future months with their own plans are listed', async () => {
    const { client } = makeFakeCardSupabase({
      ...seed(),
      monthly_goals: [goal('2026-07', 1), goal('2026-08', 900), goal('2026-09', 1), goal('2026-10', 1), goal('2026-11', 1200)],
    });
    // Sep 29, close 15: Aug and Sep closed; Oct open; Nov future.
    const months = await fetchLaterOwnPlanMonths(client as never, 'hh-1', CARD, '2026-07', 15, '2026-09-29');
    expect(months).toEqual(['2026-10', '2026-11', '2026-12']);
  });
});
