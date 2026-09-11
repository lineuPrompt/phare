import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeFakeCardSupabase, FREE_HOUSEHOLD, type Row } from './fakeCardSupabase';

/**
 * CLOSED-CYCLE LOCK (2026-09-11) — POST /api/card-envelope refuses to write a
 * goal or category budgets for a statement cycle whose close date has passed.
 *
 * These drive the real exported POST handler directly, i.e. with the Cards
 * page's hidden Edit button bypassed entirely — the server is the enforcement,
 * the UI is a courtesy. Every refusal is also checked for ZERO writes: a lock
 * that rejects after writing the goal row would still rewrite history.
 */

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const VISA = 'card-visa';

function seed(closeDay: number | null): Record<string, Row[]> {
  return {
    users: [{ id: 'user-1', household_id: 'hh-1' }],
    households: [FREE_HOUSEHOLD],
    accounts: [{ id: VISA, household_id: 'hh-1', name: 'Visa', type: 'credit_card', statement_close_day: closeDay, payment_day: 17 }],
    monthly_goals: [{ household_id: 'hh-1', account_id: VISA, month: '2026-08-01', card_goal: 3315 }],
    card_envelope_items: [{ household_id: 'hh-1', account_id: VISA, category_id: 'cat-groceries', month: '2026-08-01', monthly_amount: 700 }],
  };
}

async function post(client: unknown, body: Record<string, unknown>) {
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const { POST } = await import('../route');
  return POST(new Request('http://localhost/api/card-envelope', { method: 'POST', body: JSON.stringify(body) }));
}

// Rewrite August's plan: goal 9999, groceries 1, and try to move the close day.
const rewriteAugust = {
  cardId: VISA, month: '2026-08', totalGoal: 9999,
  items: [{ categoryId: 'cat-groceries', monthlyAmount: 1 }],
  statementCloseDay: 27, paymentDay: 17,
};

describe('POST /api/card-envelope — closed-cycle lock', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('refuses a write to a closed cycle with 409 cycle_closed, and writes NOTHING', async () => {
    // Visa closes the 27th: August's cycle is Jul 28 – Aug 27, long closed on Sep 11.
    vi.setSystemTime(new Date('2026-09-11T12:00:00-04:00'));
    const { client, store, writes } = makeFakeCardSupabase(seed(27));

    const res = await post(client, rewriteAugust);

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('cycle_closed');
    expect(writes).toEqual([]);
    expect(store.monthly_goals[0].card_goal).toBe(3315);
    expect(store.card_envelope_items).toHaveLength(1);
    expect(store.card_envelope_items[0].monthly_amount).toBe(700);
  });

  it('refusing the plan also refuses the statement-day change riding in the same request', async () => {
    vi.setSystemTime(new Date('2026-09-11T12:00:00-04:00'));
    const { client, store } = makeFakeCardSupabase(seed(27));

    await post(client, { ...rewriteAugust, statementCloseDay: 5, paymentDay: 25 });

    expect(store.accounts[0].statement_close_day).toBe(27);
    expect(store.accounts[0].payment_day).toBe(17);
  });

  it('the OPEN cycle still saves normally', async () => {
    vi.setSystemTime(new Date('2026-09-11T12:00:00-04:00'));
    const { client, store } = makeFakeCardSupabase(seed(27));

    const res = await post(client, { ...rewriteAugust, month: '2026-09' }); // Aug 28 – Sep 27: open

    expect(res.status).toBe(200);
    expect(store.monthly_goals.find((g) => g.month === '2026-09-01')?.card_goal).toBe(9999);
  });

  it('a FUTURE cycle still saves normally', async () => {
    vi.setSystemTime(new Date('2026-09-11T12:00:00-04:00'));
    const { client } = makeFakeCardSupabase(seed(27));
    const res = await post(client, { ...rewriteAugust, month: '2026-12' });
    expect(res.status).toBe(200);
  });

  it('the close date itself is still open — the lock starts the day AFTER', async () => {
    vi.setSystemTime(new Date('2026-08-27T12:00:00-04:00')); // August's close date
    const onClose = makeFakeCardSupabase(seed(27));
    expect((await post(onClose.client, rewriteAugust)).status).toBe(200);

    vi.resetModules();
    vi.setSystemTime(new Date('2026-08-28T12:00:00-04:00')); // the day after
    const dayAfter = makeFakeCardSupabase(seed(27));
    expect((await post(dayAfter.client, rewriteAugust)).status).toBe(409);
    expect(dayAfter.writes).toEqual([]);
  });

  it('uses the STORED close day: a request cannot unlock a month by claiming a later close day', async () => {
    // Aug 29, stored close 27 → August closed. Claiming close 31 in the body
    // would make August's cycle run to Aug 31 (open) if the body were trusted.
    vi.setSystemTime(new Date('2026-08-29T12:00:00-04:00'));
    const { client, writes } = makeFakeCardSupabase(seed(27));

    const res = await post(client, { ...rewriteAugust, statementCloseDay: 31 });

    expect(res.status).toBe(409);
    expect(writes).toEqual([]);
  });

  it('no close day set: the calendar month is the cycle, closed once the month ends', async () => {
    vi.setSystemTime(new Date('2026-08-31T12:00:00-04:00'));
    const lastDay = makeFakeCardSupabase(seed(null));
    expect((await post(lastDay.client, { ...rewriteAugust, statementCloseDay: undefined })).status).toBe(200);

    vi.resetModules();
    vi.setSystemTime(new Date('2026-09-01T12:00:00-04:00'));
    const nextMonth = makeFakeCardSupabase(seed(null));
    expect((await post(nextMonth.client, { ...rewriteAugust, statementCloseDay: undefined })).status).toBe(409);
  });

  it('"today" is the household\'s day, not UTC: 9pm Toronto on the close date is still open', async () => {
    // 2026-08-28T01:00Z is still Aug 27 in Toronto.
    vi.setSystemTime(new Date('2026-08-28T01:00:00Z'));
    const { client } = makeFakeCardSupabase(seed(27));
    expect((await post(client, rewriteAugust)).status).toBe(200);
  });
});
