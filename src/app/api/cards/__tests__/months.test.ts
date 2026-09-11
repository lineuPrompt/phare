import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeFakeCardSupabase, FREE_HOUSEHOLD, PRO_HOUSEHOLD, type Row } from '../../card-envelope/__tests__/fakeCardSupabase';

/**
 * GET /api/cards/months — the Cards page picker's reachable range (2026-09-11).
 *
 *   floor: queried from real data — earliest cycle with a card transaction
 *          or a saved plan. Every floor below is produced by changing the
 *          DATA, never the clock, to prove nothing is hardcoded.
 *   end:   the entitled horizon, which must equal the Timeline's own value
 *          exactly. The horizon tests run at the Timeline route test's clock
 *          (2026-07-20) and assert the same months its includePlan tests
 *          assert: free → 2026-09, Pro → 2027-06.
 */

vi.mock('@/lib/supabase-server', () => ({ createClient: vi.fn() }));

const VISA = 'card-visa';     // closes the 27th
const COSTCO = 'card-costco'; // closes the 15th
const LOOSE = 'card-loose';   // no close day — calendar months

function seed(opts: { household?: Row; transactions?: Row[]; items?: Row[]; goals?: Row[]; cards?: Row[] } = {}): Record<string, Row[]> {
  return {
    users: [{ id: 'user-1', household_id: 'hh-1' }],
    households: [opts.household ?? FREE_HOUSEHOLD],
    accounts: opts.cards ?? [
      { id: 'chq', household_id: 'hh-1', type: 'chequing', statement_close_day: null },
      { id: VISA, household_id: 'hh-1', type: 'credit_card', statement_close_day: 27 },
      { id: COSTCO, household_id: 'hh-1', type: 'credit_card', statement_close_day: 15 },
    ],
    transactions: opts.transactions ?? [],
    card_envelope_items: opts.items ?? [],
    monthly_goals: opts.goals ?? [],
  };
}

const txn = (account_id: string, date: string): Row => ({ household_id: 'hh-1', account_id, date, amount: 10, type: 'expense' });

async function getMonths(s: Record<string, Row[]>, failTables?: string[]) {
  const { client } = makeFakeCardSupabase(s, { failTables });
  const { createClient } = await import('@/lib/supabase-server');
  (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
  const { GET } = await import('../months/route');
  return GET();
}

describe('GET /api/cards/months — floor from real data', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-11T12:00:00-04:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('the founder\'s shape: June 29 on a close-27 card and June 20 on a close-15 card both belong to JULY → floor 2026-07', async () => {
    const res = await getMonths(seed({ transactions: [txn(VISA, '2026-06-29'), txn(COSTCO, '2026-06-20'), txn(VISA, '2026-08-10')] }));
    const d = await res.json();
    expect(d.floorMonth).toBe('2026-07');
    expect(d.months[0]).toBe('2026-07');
    expect(d.currentMonth).toBe('2026-09');
  });

  it('maps each card\'s date through ITS OWN close day: a June 30 charge on a no-close-day card is JUNE', async () => {
    const res = await getMonths(seed({
      cards: [
        { id: VISA, household_id: 'hh-1', type: 'credit_card', statement_close_day: 27 },
        { id: LOOSE, household_id: 'hh-1', type: 'credit_card', statement_close_day: null },
      ],
      // Visa's earliest is EARLIER by date, but lands in July's cycle;
      // the loose card's later date is in June's calendar month.
      transactions: [txn(VISA, '2026-06-29'), txn(LOOSE, '2026-06-30')],
    }));
    expect((await res.json()).floorMonth).toBe('2026-06');
  });

  it('a saved plan earlier than any transaction pulls the floor back (category budgets)', async () => {
    const res = await getMonths(seed({
      transactions: [txn(VISA, '2026-07-05')],
      items: [{ household_id: 'hh-1', account_id: COSTCO, month: '2026-04-01', category_id: 'c', monthly_amount: 1 }],
    }));
    expect((await res.json()).floorMonth).toBe('2026-04');
  });

  it('a saved goal alone pulls the floor back too', async () => {
    const res = await getMonths(seed({
      transactions: [txn(VISA, '2026-07-05')],
      goals: [{ household_id: 'hh-1', account_id: VISA, month: '2026-05-01', card_goal: 100 }],
    }));
    expect((await res.json()).floorMonth).toBe('2026-05');
  });

  it('chequing rows and household-level (card-less) goals never move the floor', async () => {
    const res = await getMonths(seed({
      transactions: [txn('chq', '2025-01-10'), txn(VISA, '2026-08-05')],
      goals: [{ household_id: 'hh-1', account_id: null, month: '2025-01-01', card_goal: 1 }],
    }));
    expect((await res.json()).floorMonth).toBe('2026-08');
  });

  it('no card history at all: the floor is the current month', async () => {
    const res = await getMonths(seed());
    const d = await res.json();
    expect(d.floorMonth).toBe('2026-09');
    expect(d.months[0]).toBe('2026-09');
  });

  it('only FUTURE-dated card rows: the floor never goes past the current month', async () => {
    const res = await getMonths(seed({ transactions: [txn(VISA, '2026-12-01')] }));
    expect((await res.json()).floorMonth).toBe('2026-09');
  });

  it('a failed read is a 500 — never a silent current-month floor that hides history', async () => {
    const res = await getMonths(seed({ transactions: [txn(VISA, '2026-06-29')] }), ['transactions']);
    expect(res.status).toBe(500);
  });

  it('a failed snapshot read is a 500 too (category budgets, then goals)', async () => {
    for (const table of ['card_envelope_items', 'monthly_goals']) {
      vi.resetModules();
      const res = await getMonths(seed({ transactions: [txn(VISA, '2026-07-05')] }), [table]);
      expect(res.status).toBe(500);
    }
  });
});

describe('GET /api/cards/months — horizon matches the Timeline exactly', () => {
  beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-07-20T12:00:00')); });
  afterEach(() => { vi.useRealTimers(); });

  it('FREE: ends 2026-09 (3 months: Jul, Aug, Sep) — the Timeline route test\'s free value', async () => {
    const d = await (await getMonths(seed({ household: FREE_HOUSEHOLD, transactions: [txn(VISA, '2026-07-05')] }))).json();
    expect(d.horizonEndMonth).toBe('2026-09');
    expect(d.months).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(d.isPro).toBe(false);
    expect(d.lockedMonthCount).toBe(9);
  });

  it('PRO: ends 2027-06 (12 months) — the Timeline route test\'s Pro value', async () => {
    const d = await (await getMonths(seed({ household: PRO_HOUSEHOLD, transactions: [txn(VISA, '2026-07-05')] }))).json();
    expect(d.horizonEndMonth).toBe('2027-06');
    expect(d.months).toHaveLength(12);
    expect(d.months[11]).toBe('2027-06');
    expect(d.isPro).toBe(true);
    expect(d.lockedMonthCount).toBe(0);
  });

  it('an unreadable household row fails CLOSED to the free horizon, like the Timeline', async () => {
    const { client } = makeFakeCardSupabase(seed({ household: PRO_HOUSEHOLD }));
    // Timezone read succeeds (default applies), entitlement read fails.
    const realFrom = client.from.bind(client);
    let householdReads = 0;
    client.from = ((table: string) => {
      if (table === 'households' && ++householdReads === 2) {
        return { select: () => ({ eq: () => ({ single: async () => ({ data: null, error: { message: 'boom' } }) }) }) };
      }
      return realFrom(table);
    }) as typeof client.from;
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const { GET } = await import('../months/route');
    const d = await (await GET()).json();
    expect(d.isPro).toBe(false);
    expect(d.horizonEndMonth).toBe('2026-09');
  });
});
