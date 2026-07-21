import { describe, it, expect, vi, beforeEach } from 'vitest';
import { businessToday, firstOfNextMonth, materializeFromMonthStart } from '@/lib/dateHelpers';

/**
 * Timeline Part B — split-into-two-rules invariant (founder-approved
 * 2026-07-21, implemented same day). Editing a recurring rule's amount,
 * cadence, anchor date, or second day now freezes the current rule row
 * (active=false) and creates a NEW rule row effective from a chosen date
 * forward, instead of mutating the value in place. This is what fixes the
 * diagnosed live bug: the old code's re-materialization boundary was
 * "start of the current month," which silently rewrote already-happened
 * days within the current month on every value edit — the new boundary is
 * the household's own chosen effective date, defaulting to the 1st of next
 * month (so a same-month edit touches nothing that already happened, by
 * default).
 *
 * Generic in-memory mutable-store fake Supabase, supporting eq/gte/lt/in
 * filters and select/insert/update/delete — richer than the other route
 * tests' fakes because this route touches five tables in one request
 * (users, households, accounts, recurring_items, transactions,
 * recurring_skipped_dates) and needs real cross-call state (a row inserted
 * in step 3 must be queryable in step 5).
 */

type Row = Record<string, unknown> & { id: string };
type Filter = { op: 'eq' | 'gte' | 'lt' | 'in'; field: string; value: unknown };
type Store = Record<string, Row[]>;

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    if (f.op === 'eq') return row[f.field] === f.value;
    if (f.op === 'gte') return (row[f.field] as string) >= (f.value as string);
    if (f.op === 'lt') return (row[f.field] as string) < (f.value as string);
    if (f.op === 'in') return (f.value as unknown[]).includes(row[f.field]);
    return true;
  });
}

function makeFakeSupabase(seed: Store) {
  const store: Store = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, [...v]]));
  let idCounter = 1;

  function table(name: string) {
    if (!store[name]) store[name] = [];
    const rows = () => store[name];

    function selectChain(filters: Filter[]) {
      const api = {
        eq(field: string, value: unknown) { filters.push({ op: 'eq', field, value }); return api; },
        gte(field: string, value: unknown) { filters.push({ op: 'gte', field, value }); return api; },
        lt(field: string, value: unknown) { filters.push({ op: 'lt', field, value }); return api; },
        in(field: string, value: unknown[]) { filters.push({ op: 'in', field, value }); return api; },
        order() { return api; },
        single() {
          const found = rows().filter((r) => matches(r, filters));
          return Promise.resolve(found[0] ? { data: { ...found[0] }, error: null } : { data: null, error: { message: 'not found' } });
        },
        maybeSingle() {
          const found = rows().filter((r) => matches(r, filters));
          return Promise.resolve({ data: found[0] ? { ...found[0] } : null, error: null });
        },
        then(resolve: (v: { data: Row[]; error: null }) => unknown) {
          const found = rows().filter((r) => matches(r, filters)).map((r) => ({ ...r }));
          return Promise.resolve({ data: found, error: null }).then(resolve);
        },
      };
      return api;
    }

    function mutationChain(kind: 'update' | 'delete' | 'insert', payload?: unknown) {
      const filters: Filter[] = [];
      const apply = (): Row[] => {
        if (kind === 'insert') {
          const list = Array.isArray(payload) ? (payload as Record<string, unknown>[]) : [payload as Record<string, unknown>];
          const inserted = list.map((r) => ({ id: (r.id as string) ?? `${name}-${idCounter++}`, ...r } as Row));
          store[name] = [...rows(), ...inserted];
          return inserted;
        }
        if (kind === 'update') {
          const matched: Row[] = [];
          store[name] = rows().map((r) => {
            if (matches(r, filters)) { const updated = { ...r, ...(payload as object) }; matched.push(updated); return updated; }
            return r;
          });
          return matched;
        }
        // delete
        const matched: Row[] = [];
        store[name] = rows().filter((r) => {
          if (matches(r, filters)) { matched.push(r); return false; }
          return true;
        });
        return matched;
      };

      const api = {
        eq(field: string, value: unknown) { filters.push({ op: 'eq', field, value }); return api; },
        gte(field: string, value: unknown) { filters.push({ op: 'gte', field, value }); return api; },
        lt(field: string, value: unknown) { filters.push({ op: 'lt', field, value }); return api; },
        in(field: string, value: unknown[]) { filters.push({ op: 'in', field, value }); return api; },
        select() {
          const result = apply();
          return {
            single() {
              return Promise.resolve(result[0] ? { data: { ...result[0] }, error: null } : { data: null, error: { message: 'no rows' } });
            },
            then(resolve: (v: { data: Row[]; error: null }) => unknown) {
              return Promise.resolve({ data: result.map((r) => ({ ...r })), error: null }).then(resolve);
            },
          };
        },
        then(resolve: (v: { data: null; error: null }) => unknown) {
          apply();
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return api;
    }

    return {
      select() { return selectChain([]); },
      insert(payload: unknown) { return mutationChain('insert', payload); },
      update(payload: unknown) { return mutationChain('update', payload); },
      delete() { return mutationChain('delete'); },
    };
  }

  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: table,
    rpc(name: string, params: Record<string, unknown>) {
      if (name !== 'create_transfer') throw new Error(`fake supabase: unexpected rpc "${name}"`);
      return Promise.resolve({ data: null, error: { message: 'not exercised in these tests' } });
    },
    rows(name: string): Row[] { return store[name] ?? []; },
  };
}

const HOUSEHOLD = 'hh-1';
const CHEQUING = 'chq-1';

function baseSeed(): Store {
  return {
    users: [{ id: 'user-1', household_id: HOUSEHOLD } as unknown as Row],
    households: [{ id: HOUSEHOLD, timezone: 'America/Toronto' } as unknown as Row],
    accounts: [{ id: CHEQUING, household_id: HOUSEHOLD, type: 'chequing' } as unknown as Row],
  };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

describe('PATCH /api/recurring/[id] — Part B split-into-two-rules', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('an amount raise freezes the old rule, leaves history and this month untouched, and applies the new amount only from the effective date forward', async () => {
    const todayStr = businessToday('America/Toronto');
    const effectiveFrom = firstOfNextMonth(todayStr); // default — not passed in the body

    const supabase = makeFakeSupabase({
      ...baseSeed(),
      recurring_items: [
        {
          id: 'ri-salary', household_id: HOUSEHOLD, member_id: null, description: 'Salary', amount: 5000,
          type: 'income', cadence: 'monthly', anchor_date: '2020-01-01', second_day: null,
          category_id: null, account_id: CHEQUING, destination_account_id: null, active: true,
        } as unknown as Row,
      ],
      transactions: [
        // True history — a past month's paycheque.
        { id: 'tx-history', household_id: HOUSEHOLD, account_id: CHEQUING, member_id: null, category_id: null,
          amount: 5000, description: 'Salary', date: '2020-02-01', type: 'income', source: 'manual', recurring_item_id: 'ri-salary' } as unknown as Row,
        // Already happened THIS month — the exact case the old monthStart
        // boundary used to silently rewrite.
        { id: 'tx-today', household_id: HOUSEHOLD, account_id: CHEQUING, member_id: null, category_id: null,
          amount: 5000, description: 'Salary', date: todayStr, type: 'income', source: 'manual', recurring_item_id: 'ri-salary' } as unknown as Row,
        // Sitting exactly on the boundary — this one SHOULD be superseded.
        { id: 'tx-boundary', household_id: HOUSEHOLD, account_id: CHEQUING, member_id: null, category_id: null,
          amount: 5000, description: 'Salary', date: effectiveFrom, type: 'income', source: 'manual', recurring_item_id: 'ri-salary' } as unknown as Row,
      ],
      recurring_skipped_dates: [],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request('http://localhost/api/recurring/ri-salary', { method: 'PATCH', body: JSON.stringify({ amount: 6000 }) }),
      { params: Promise.resolve({ id: 'ri-salary' }) }
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json).toMatchObject({ updated: true, split: true, oldRuleId: 'ri-salary', effectiveFrom });

    // Old rule is frozen, not mutated.
    const oldRule = supabase.rows('recurring_items').find((r) => r.id === 'ri-salary')!;
    expect(oldRule.active).toBe(false);
    expect(oldRule.amount).toBe(5000); // untouched — still reads as $5000 forever, honestly

    // New rule picks up the new value from the boundary.
    const newRule = supabase.rows('recurring_items').find((r) => r.id === json.newRuleId)!;
    expect(newRule).toMatchObject({ amount: 6000, active: true, predecessor_id: 'ri-salary', effective_from: effectiveFrom });

    // True history: untouched.
    const history = supabase.rows('transactions').find((r) => r.id === 'tx-history')!;
    expect(history.amount).toBe(5000);
    expect(history.recurring_item_id).toBe('ri-salary');

    // Already-happened-this-month: untouched — this is the mid-month-rewrite
    // bug fix, proven directly.
    const todayRow = supabase.rows('transactions').find((r) => r.id === 'tx-today')!;
    expect(todayRow.amount).toBe(5000);
    expect(todayRow.recurring_item_id).toBe('ri-salary');

    // The boundary-dated row is gone (superseded)...
    expect(supabase.rows('transactions').some((r) => r.id === 'tx-boundary')).toBe(false);
    // ...replaced by a fresh row at the same date, under the new rule, at
    // the new amount.
    const replacement = supabase.rows('transactions').find((r) => r.date === effectiveFrom && r.recurring_item_id === json.newRuleId);
    expect(replacement).toBeTruthy();
    expect(replacement!.amount).toBe(6000);

    // Every row the new rule materialized is >= the boundary and at the new amount.
    const newRuleRows = supabase.rows('transactions').filter((r) => r.recurring_item_id === json.newRuleId);
    expect(newRuleRows.length).toBeGreaterThan(0);
    for (const row of newRuleRows) {
      expect((row.date as string) >= effectiveFrom).toBe(true);
      expect(row.amount).toBe(6000);
    }
  });

  it('a mid-cadence effective date drops the natural occurrence that falls before it, rather than duplicating or moving it', async () => {
    const todayStr = businessToday('America/Toronto');
    const monthStart = firstOfNextMonth(todayStr); // always safely in the future
    const anchorDate = monthStart; // biweekly anchored on the 1st of that month
    const effectiveFrom = `${monthStart.slice(0, 8)}15`; // the 15th of that same month

    const supabase = makeFakeSupabase({
      ...baseSeed(),
      recurring_items: [
        {
          id: 'ri-rent', household_id: HOUSEHOLD, member_id: null, description: 'Rent', amount: 1000,
          type: 'expense', cadence: 'monthly', anchor_date: '2020-01-01', second_day: null,
          category_id: 'cat-housing', account_id: CHEQUING, destination_account_id: null, active: true,
        } as unknown as Row,
      ],
      accounts: [
        ...baseSeed().accounts,
      ],
      transactions: [],
      recurring_skipped_dates: [],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request('http://localhost/api/recurring/ri-rent', {
        method: 'PATCH',
        body: JSON.stringify({ amount: 1000, cadence: 'biweekly', anchorDate, effectiveFrom, categoryId: 'cat-housing' }),
      }),
      { params: Promise.resolve({ id: 'ri-rent' }) }
    );
    const json = await res.json();
    expect(res.status).toBe(200);

    const newRuleDates = supabase.rows('transactions')
      .filter((r) => r.recurring_item_id === json.newRuleId)
      .map((r) => r.date as string)
      .sort();

    // Sanity: the raw biweekly math (independent of the route) really would
    // have produced the 1st as an occurrence — confirms this is a genuine
    // boundary case, not a fixture that never exercised the filter.
    const raw = materializeFromMonthStart({ cadence: 'biweekly', anchorDate, secondDay: null }, effectiveFrom, 1);
    expect(raw).toContain(anchorDate);

    expect(newRuleDates).not.toContain(anchorDate); // the 1st — belongs to the OLD rule's history, not this one
    expect(newRuleDates[0]).toBe(effectiveFrom); // the 15th — first date actually owned by the new rule
    for (const d of newRuleDates) {
      expect(d >= effectiveFrom).toBe(true);
    }
  });

  it('composes with Part A3: a tombstone dated on/after the boundary carries forward, so the new rule does not resurrect a detached occurrence', async () => {
    const todayStr = businessToday('America/Toronto');
    const effectiveFrom = firstOfNextMonth(todayStr);

    const supabase = makeFakeSupabase({
      ...baseSeed(),
      recurring_items: [
        {
          id: 'ri-phone', household_id: HOUSEHOLD, member_id: null, description: 'Phone bill', amount: 60,
          type: 'expense', cadence: 'monthly', anchor_date: '2020-01-01', second_day: null,
          category_id: 'cat-utilities', account_id: CHEQUING, destination_account_id: null, active: true,
        } as unknown as Row,
      ],
      transactions: [],
      // The household already detached (edited or deleted) the occurrence
      // that would otherwise land exactly on the new rule's first date.
      recurring_skipped_dates: [
        { id: 'rsd-1', household_id: HOUSEHOLD, recurring_item_id: 'ri-phone', date: effectiveFrom } as unknown as Row,
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request('http://localhost/api/recurring/ri-phone', { method: 'PATCH', body: JSON.stringify({ amount: 70 }) }),
      { params: Promise.resolve({ id: 'ri-phone' }) }
    );
    const json = await res.json();
    expect(res.status).toBe(200);

    // The tombstone was carried forward under the NEW rule's id.
    const carried = supabase.rows('recurring_skipped_dates').filter((r) => r.recurring_item_id === json.newRuleId);
    expect(carried).toHaveLength(1);
    expect(carried[0].date).toBe(effectiveFrom);

    // And the new rule's materialization actually honoured it — no row at
    // that date, first materialized row is the FOLLOWING month instead.
    const newRuleDates = supabase.rows('transactions')
      .filter((r) => r.recurring_item_id === json.newRuleId)
      .map((r) => r.date as string)
      .sort();
    expect(newRuleDates).not.toContain(effectiveFrom);
    expect(newRuleDates.length).toBeGreaterThan(0);
    expect(newRuleDates[0] > effectiveFrom).toBe(true);
  });

  it('rejects an effective date in the past — past occurrences can never be re-opened', async () => {
    const todayStr = businessToday('America/Toronto');
    const supabase = makeFakeSupabase({
      ...baseSeed(),
      recurring_items: [
        {
          id: 'ri-x', household_id: HOUSEHOLD, member_id: null, description: 'X', amount: 100,
          type: 'expense', cadence: 'monthly', anchor_date: '2020-01-01', second_day: null,
          category_id: 'cat-x', account_id: CHEQUING, destination_account_id: null, active: true,
        } as unknown as Row,
      ],
      transactions: [],
      recurring_skipped_dates: [],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request('http://localhost/api/recurring/ri-x', {
        method: 'PATCH',
        body: JSON.stringify({ amount: 150, effectiveFrom: '2020-01-01' }),
      }),
      { params: Promise.resolve({ id: 'ri-x' }) }
    );
    expect(res.status).toBe(400);
    // Nothing should have been touched — the guard fires before any write.
    expect(supabase.rows('recurring_items').find((r) => r.id === 'ri-x')!.active).toBe(true);
    expect(supabase.rows('recurring_items')).toHaveLength(1);
    void todayStr;
  });

  it('a category-only edit (no value change) never splits — takes the metadata path', async () => {
    const supabase = makeFakeSupabase({
      ...baseSeed(),
      recurring_items: [
        {
          id: 'ri-y', household_id: HOUSEHOLD, member_id: null, description: 'Groceries', amount: 200,
          type: 'expense', cadence: 'monthly', anchor_date: '2020-01-01', second_day: null,
          category_id: 'cat-old', account_id: CHEQUING, destination_account_id: null, active: true,
        } as unknown as Row,
      ],
      transactions: [],
      recurring_skipped_dates: [],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(supabase);

    const { PATCH } = await import('../route');
    const res = await PATCH(
      new Request('http://localhost/api/recurring/ri-y', { method: 'PATCH', body: JSON.stringify({ categoryId: 'cat-new' }) }),
      { params: Promise.resolve({ id: 'ri-y' }) }
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.split).toBeUndefined();

    // Still exactly one rule row, updated in place, still active.
    expect(supabase.rows('recurring_items')).toHaveLength(1);
    const rule = supabase.rows('recurring_items')[0];
    expect(rule.id).toBe('ri-y');
    expect(rule.active).toBe(true);
    expect(rule.category_id).toBe('cat-new');
    expect(rule.amount).toBe(200);
  });
});
