import { describe, it, expect, vi, beforeEach } from 'vitest';

// Regression test for the manual-entry-onboards-but-dashboard-is-empty bug:
// hasPlan used to be gated on the `budgets` table having a row, which is
// only populated when the plan has at least one VARIABLE-expense category.
// A minimal manual entry (income + a fixed bill, no day-to-day spending
// categories) legitimately has zero budget rows despite being a fully
// saved, valid plan — confirmed live against a real household (2
// recurring_items, 24 transactions, 1 account, 0 budgets). file_imports is
// the correct signal: every completed save-plan run inserts exactly one row
// there, unconditionally, via the same call regardless of source.

type Resolution = { data?: unknown; error?: unknown; count?: number };

function makeResultChain(resolution: Resolution) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') {
        return (reject: (v: unknown) => unknown) => Promise.resolve(resolution).catch(reject);
      }
      return (..._args: unknown[]) => makeResultChain(resolution);
    },
  };
  return new Proxy({}, handler);
}

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};

  function entry(table: string, resolutionOverride?: Resolution) {
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      // events/isFirstReturnToday is fire-and-forget and shields its own
      // errors — safe to leave unscripted, same as every other test in
      // this codebase using this harness pattern.
      if (table === 'events') return makeResultChain({ data: null, error: null, count: 0 });
      throw new Error(`No scripted response for table "${table}" call #${idx + 1}`);
    }
    return makeResultChain(resolutionOverride ?? list[idx]);
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: () => entry(table),
      insert: () => entry(table),
    }),
  };

  return { client };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/bridgeHelpers', () => ({
  ensureBridgesForWindow: vi.fn(),
}));

describe('GET /api/dashboard — plan existence gate', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a household with zero budget rows but a completed onboarding (file_imports) still has a plan', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', full_name: 'Lineu Prompt' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }], // the plan-existence check
      budgets: [
        { data: null, error: null }, // planMonth lookup — none exist, falls back to actuals month
        { data: [], error: null },   // budget-vs-actual comparison rows
      ],
      transactions: [
        {
          data: [
            { amount: 2000, type: 'income', account_id: 'chq-1' },
            { amount: 800, type: 'expense', account_id: 'chq-1' },
          ],
          error: null,
        },
      ],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      account_balance_anchors: [{ data: { anchor_date: '2026-01-01' }, error: null }], // earliestAnchorMonth lookup
      sinking_funds: [{ data: [], error: null }],
      conversations: [{ data: null, error: null }],
      recurring_items: [
        { count: 0, error: null }, // unanchored income
        { count: 0, error: null }, // unanchored expense
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/dashboard'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.hasPlan).toBe(true);
    expect(json.summary.totalIncome).toBe(2000);
    expect(json.summary.totalExpenses).toBe(800);
  });

  it('a household with no completed onboarding at all (no file_imports) has no plan', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh2', full_name: 'Nobody' }, error: null }],
      file_imports: [{ data: null, error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/dashboard'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ hasPlan: false });
  });
});

// Dashboard full-reload fix (2026-07-22): switching the snapshot's month
// used to re-fetch/re-render the WHOLE dashboard. The fix is
// snapshotOnly=1 on this same route, which skips the budgets/sinking_funds/
// conversations queries entirely and returns only the snapshot's own
// fields. This test proves that mode never touches those tables at all
// (they're deliberately left unscripted here — any query against them would
// throw "No scripted response", failing the test) and that non-snapshot
// fields (goalAccounts, review, etc.) are simply absent from the response.
// Sinking funds become fundable (Build 4 Part 2, 2026-07-21): a fund's real
// balance is derived from its linked account's own ledger, never a stored
// current_balance column, and a fund account must never double-render as a
// generic goal on the same dashboard.
describe('GET /api/dashboard — sinking fund real balance', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('a linked fund shows its real ledger balance and fundedAlready, and never appears in goalAccounts', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', full_name: 'Lineu Prompt' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      budgets: [
        { data: null, error: null },
        { data: [], error: null },
      ],
      accounts: [{
        data: [
          { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null, payment_day: null, statement_close_day: null },
          { id: 'fund-1', name: 'Property tax fund', type: 'savings', goal_target: null, goal_target_date: null, payment_day: null, statement_close_day: null, is_sinking_fund: true },
        ],
        error: null,
      }],
      account_balance_anchors: [{ data: null, error: null }],
      transactions: [
        { data: [], error: null }, // actuals-month headline figures
        { // all-time goal/fund tx fetch
          data: [
            { amount: 300, type: 'transfer', account_id: 'fund-1', date: '2020-01-01' },
            { amount: 100, type: 'expense',  account_id: 'fund-1', date: '2020-02-01' },
          ],
          error: null,
        },
      ],
      sinking_funds: [{
        data: [{ id: 'sf-1', name: 'Property tax', annual_amount: 3600, monthly_provision: 300, due_month: 3, linked_account_id: 'fund-1' }],
        error: null,
      }],
      conversations: [{ data: null, error: null }],
      recurring_items: [
        { count: 0, error: null },
        { count: 0, error: null },
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/dashboard'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sinkingFunds).toEqual([{
      id: 'sf-1',
      name: 'Property tax',
      annual_amount: 3600,
      monthly_provision: 300,
      due_month: 3,
      current_balance: 200, // 300 contributed − 100 paid out
      fundedAlready: true,
      linkedAccountId: 'fund-1',
    }]);
    // The fund account is type='savings' and would otherwise qualify as a
    // goal — it must never also render on the Goals section.
    expect(json.goalAccounts).toEqual([]);
  });

  it('an unlinked (not-yet-started) fund reads balance 0 and fundedAlready:false', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1', full_name: 'Lineu Prompt' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      budgets: [
        { data: null, error: null },
        { data: [], error: null },
      ],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null, payment_day: null, statement_close_day: null }], error: null }],
      account_balance_anchors: [{ data: null, error: null }],
      transactions: [{ data: [], error: null }],
      sinking_funds: [{
        data: [{ id: 'sf-2', name: 'Christmas', annual_amount: 1200, monthly_provision: 100, due_month: 12, linked_account_id: null }],
        error: null,
      }],
      conversations: [{ data: null, error: null }],
      recurring_items: [
        { count: 0, error: null },
        { count: 0, error: null },
      ],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/dashboard'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sinkingFunds[0].current_balance).toBe(0);
    expect(json.sinkingFunds[0].fundedAlready).toBe(false);
    expect(json.sinkingFunds[0].linkedAccountId).toBeNull();
  });
});

describe('GET /api/dashboard?snapshotOnly=1 — month-switch fetch never touches unrelated sections', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns only snapshot fields, without ever querying budgets/sinking_funds/conversations', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh4', full_name: 'Someone' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null, payment_day: null, statement_close_day: null }], error: null }],
      account_balance_anchors: [{ data: { anchor_date: '2026-01-01' }, error: null }],
      transactions: [{
        data: [
          { amount: 3000, type: 'income', account_id: 'chq-1' },
          { amount: 1200, type: 'expense', account_id: 'chq-1' },
        ],
        error: null,
      }],
      recurring_items: [
        { count: 0, error: null },
        { count: 0, error: null },
      ],
      // budgets / sinking_funds / conversations deliberately NOT scripted —
      // snapshotOnly must never reach them.
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/dashboard?month=2026-08&snapshotOnly=1'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      hasPlan: true,
      month: '2026-08-01',
      summary: { totalIncome: 3000, totalExpenses: 1200, totalSavings: 0, netCashFlow: 1800 },
      unanchoredIncomeCount: 0,
      unanchoredExpenseCount: 0,
      earliestAnchorMonth: '2026-01',
    });
    // Explicitly absent — proves the goals/review/etc. code path never ran.
    expect(json.goalAccounts).toBeUndefined();
    expect(json.review).toBeUndefined();
    expect(json.sinkingFunds).toBeUndefined();
    expect(json.categories).toBeUndefined();
  });
});

// Follow-up to the mobile-nav/snapshot-navigation handoff (2026-07-20) and
// the Tier 2 bridge hardening (2026-07-22): the dashboard route calls
// ensureBridgesForWindow on every read (added so a never-visited future
// month still shows its card bridge). Once ensureBridgesForWindow was made
// to throw on any read/write error instead of silently under-syncing, this
// proves that failure actually reaches the client as a real error — not a
// dashboard that quietly renders an understated snapshot. ensureBridgesForWindow
// itself is mocked here (its own read/write failure modes are covered by
// bridgeReconciliationInvariant.test.ts) — this test is only about whether
// dashboard/route.ts lets a thrown error from it escape as a 500.
describe('GET /api/dashboard — a bridge-sync failure surfaces, never a silently understated snapshot', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('ensureBridgesForWindow throwing produces a 500, not a 200 with incomplete figures', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh3', full_name: 'Someone' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      file_imports: [{ data: { id: 'imp-1' }, error: null }],
      budgets: [
        { data: null, error: null },
        { data: [], error: null },
      ],
      accounts: [{
        data: [
          { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null, payment_day: null, statement_close_day: null },
          { id: 'card-1', name: 'Visa', type: 'credit_card', goal_target: null, goal_target_date: null, payment_day: 5, statement_close_day: 15 },
        ],
        error: null,
      }],
      account_balance_anchors: [{ data: { anchor_date: '2026-01-01' }, error: null }],
      household_members: [{ data: { id: 'member-1' }, error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { ensureBridgesForWindow } = await import('@/lib/bridgeHelpers');
    (ensureBridgesForWindow as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ensureBridgesForWindow: failed to read card transactions — simulated')
    );

    const { GET } = await import('../route');
    const res = await GET(new Request('http://localhost/api/dashboard'));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.hasPlan).toBeUndefined(); // never got far enough to build a (partial) success payload
    expect(json.error).toBeTruthy();
  });
});
