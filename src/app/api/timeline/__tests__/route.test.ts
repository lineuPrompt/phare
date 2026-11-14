import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordedEvents } from '../../../../test/eventWriterDouble';

// These tests cover the additive Phase 3 surface only: the optional
// `windowStart` query param and the `unbalancedDays` response field.
// ensureBridgesForWindow is mocked out — its own behavior is covered by
// bridgeHelpers.test.ts, and scripting its internal supabase calls here
// would just duplicate that coverage for no benefit.

type Resolution = { data?: unknown; error?: unknown; count?: number };

function makeResultChain(resolution: Resolution) {
  const handler: ProxyHandler<object> = {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      return (..._args: unknown[]) => makeResultChain(resolution);
    },
  };
  return new Proxy({}, handler);
}

type Call = { table: string; args: unknown[] };

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};
  const calls: Call[] = [];

  function entry(table: string, args: unknown[]) {
    calls.push({ table, args });
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      throw new Error(`No scripted response for table "${table}" call #${idx + 1}`);
    }
    return makeResultChain(list[idx]);
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: (...args: unknown[]) => entry(table, args),
      // Only 'events' inserts are exercised by these tests (logEvent) — a
      // plain resolved success is all any caller here needs.
      insert: (row: unknown) => {
        calls.push({ table, args: ['insert', row] });
        return Promise.resolve({ error: null });
      },
    }),
  };

  return { client, calls };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

const ensureBridgesMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/bridgeHelpers', async (importOriginal) => ({
  // The pure helpers stay real: the plan's card cost reads netCycleSpend.
  ...(await importOriginal<typeof import('@/lib/bridgeHelpers')>()),
  ensureBridgesForWindow: (...args: unknown[]) => ensureBridgesMock(...args),
}));

async function getTimeline(query: string) {
  const { GET } = await import('../route');
  return GET(new Request(`http://localhost/api/timeline?${query}`));
}

describe('GET /api/timeline — windowStart param and unbalancedDays', () => {
  beforeEach(() => {
    vi.resetModules();
    ensureBridgesMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects a malformed windowStart before touching the database', async () => {
    const res = await getTimeline('account=acc-1&windowStart=2026-07-15');
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/windowStart/);
  });

  it('default window (no windowStart) returns unbalancedDays: [] alongside the existing shape', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' } }],
      households: [{ data: { timezone: 'America/Toronto' } }],
      accounts: [
        { data: { id: 'acc-1', type: 'chequing' } }, // target account lookup
        { data: [] },                                 // card accounts (none)
      ],
      household_members: [{ data: { id: 'mem-1' } }],
      account_balance_anchors: [{ data: [{ anchor_date: '2026-07-01', balance: 1000 }] }],
      transactions: [{ data: [] }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.balancesStartDate).toBe('2026-07-01');
    expect(json.unbalancedDays).toEqual([]);
    expect(ensureBridgesMock).toHaveBeenCalledTimes(1);
  });

  it('windowStart earlier than the first anchor surfaces pre-anchor entries as unbalancedDays, scoped to that range', async () => {
    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' } }],
      households: [{ data: { timezone: 'America/Toronto' } }],
      accounts: [
        { data: { id: 'acc-1', type: 'chequing' } },
        { data: [] },
      ],
      household_members: [{ data: { id: 'mem-1' } }],
      account_balance_anchors: [{ data: [{ anchor_date: '2026-07-15', balance: 500 }] }],
      transactions: [
        { data: [] }, // main fetch: from anchor date (07-15) through windowEnd — empty for this test
        {
          data: [
            {
              id: 'tx-1', date: '2026-07-03', description: 'Paycheque', amount: 200, type: 'income',
              recurring_item_id: null, recurrence_id: null, installment_label: null,
              transfer_peer_id: null, is_bridge: false, bridge_source_account: null,
            },
          ],
        }, // pre-anchor fetch: windowStart (07-01) through balancesStartDate (07-15)
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&windowStart=2026-07-01');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.balancesStartDate).toBe('2026-07-15');
    expect(json.unbalancedDays).toEqual([
      { date: '2026-07-03', entries: [expect.objectContaining({ id: 'tx-1', type: 'income' })] },
    ]);

    // Two transactions calls were made: the buildCashTimeline fetch (from the
    // anchor date) and the separate pre-anchor fetch (from windowStart).
    const txCalls = calls.filter((c) => c.table === 'transactions');
    expect(txCalls).toHaveLength(2);
  });

  it('a windowStart later than the default is ignored (never extends the window forward)', async () => {
    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' } }],
      households: [{ data: { timezone: 'America/Toronto' } }],
      accounts: [
        { data: { id: 'acc-1', type: 'chequing' } },
        { data: [] },
      ],
      household_members: [{ data: { id: 'mem-1' } }],
      account_balance_anchors: [{ data: [{ anchor_date: '2026-06-01', balance: 1000 }] }],
      transactions: [{ data: [] }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    // 2026-09-01 is after the default windowStart (2026-07-01) — must be clamped to default.
    const res = await getTimeline('account=acc-1&windowStart=2026-09-01');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.balancesStartDate).toBe('2026-07-01'); // default windowStart, not clamped forward to Sept
  });
});

describe('GET /api/timeline — timeline_opened funnel event', () => {
  beforeEach(() => {
    vi.resetModules();
    ensureBridgesMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseScript = {
    users: [{ data: { household_id: 'hh1' } }],
    households: [{ data: { timezone: 'America/Toronto' } }],
    accounts: [
      { data: { id: 'acc-1', type: 'chequing' } },
      { data: [] },
    ],
    household_members: [{ data: { id: 'mem-1' } }],
    account_balance_anchors: [{ data: [{ anchor_date: '2026-07-01', balance: 1000 }] }],
    transactions: [{ data: [] }],
  };

  it('fires once on a genuine Timeline page load (pageView=1)', async () => {
    const { client, calls } = makeSupabaseMock(baseScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&pageView=1');
    expect(res.status).toBe(200);

    // Written through the service role (eventWriter), never the session.
    expect(calls.filter((c) => c.table === 'events')).toHaveLength(0);
    expect(recordedEvents).toHaveLength(1);
    expect(recordedEvents[0]).toMatchObject({ event_type: 'timeline_opened', household_id: expect.any(String) });
  });

  it('does NOT fire when pageView is absent — the dashboard\'s dip-tile call to this same endpoint must never count as a Timeline open', async () => {
    const { client } = makeSupabaseMock(baseScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1');
    expect(res.status).toBe(200);

    expect(recordedEvents).toHaveLength(0);
  });

  it('fires on every real load, not gated to the first ever — a repeat visit still logs (frequency signal, not a one-time milestone)', async () => {
    const { client, calls } = makeSupabaseMock(baseScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    await getTimeline('account=acc-1&pageView=1');

    // A second, independent page load (fresh mock instance, same household)
    // must fire again — this is not an isFirstEvent-gated milestone.
    const { client: client2, calls: calls2 } = makeSupabaseMock(baseScript);
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client2);
    await getTimeline('account=acc-1&pageView=1');

    // One row per load, both through the event writer.
    void calls;
    void calls2;
    expect(recordedEvents.map((e) => e.event_type)).toEqual(['timeline_opened', 'timeline_opened']);
  });
});

describe('GET /api/timeline — includePlan (the chained 12-month plan)', () => {
  beforeEach(() => {
    vi.resetModules();
    ensureBridgesMock.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T12:00:00'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseScript = {
    users: [{ data: { household_id: 'hh1' } }],
    // Read TWICE now: getHouseholdTimezone, then loadEntitlement.
    households: [
      { data: { timezone: 'America/Toronto' } },
      { data: { subscription_status: null, subscription_current_period_end: null, comp_until: null } },
    ],
    accounts: [
      { data: { id: 'acc-1', type: 'chequing' } },
      { data: [] }, // no credit cards — skips the monthly_goals/card-transactions queries
      { data: [{ id: 'acc-1', type: 'chequing' }] }, // every account — the breakdown's classifier
    ],
    household_members: [{ data: { id: 'mem-1' } }],
    account_balance_anchors: [{ data: [{ anchor_date: '2026-07-01', balance: 1000 }] }],
    transactions: [
      { data: [] }, // main real-walk fetch (also reused as the plan's dated basis)
    ],
    recurring_items: [
      { data: [] },           // the rules (extra payments)
      { count: 0, data: [] }, // unanchored income count
      { count: 0, data: [] }, // unanchored expense count
    ],
  };

  it('omits `plan` entirely when includePlan is not passed (no extra queries run)', async () => {
    const { client, calls } = makeSupabaseMock({ ...baseScript, transactions: [{ data: [] }] });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.plan).toBeNull();
    expect(calls.filter((c) => c.table === 'recurring_items')).toHaveLength(0);
  });

  /** baseScript with the entitlement read replaced by a Pro household. */
  const proScript = {
    ...baseScript,
    households: [
      { data: { timezone: 'America/Toronto' } },
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null } },
    ],
  };

  it('includePlan=1 returns a 12-month chain to a PRO household, anchored at todayBalance', async () => {
    const { client } = makeSupabaseMock(proScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&includePlan=1');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.todayBalance).toBe(1000);
    expect(json.plan).not.toBeNull();
    expect(json.plan.months).toHaveLength(12);
    expect(json.plan.horizonMonths).toBe(12);
    expect(json.plan.horizonLocked).toBe(false);
    expect(json.plan.months[0].month).toBe('2026-07');
    expect(json.plan.months[0].isPartialMonth).toBe(true);
    // Month-nav horizon. GET /api/cards/months asserts this SAME value at the
    // same clock (cards/__tests__/months.test.ts) — the two must never differ.
    expect(json.horizonEndMonth).toBe('2027-06');
    // No dated rows, no card cost → the anchor never moves.
    expect(json.plan.months.every((m: { balance: number }) => m.balance === 1000)).toBe(true);
  });

  it('a FREE household receives only 3 months — the rest is not in the payload', async () => {
    const { client } = makeSupabaseMock(baseScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&includePlan=1');
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.plan.months).toHaveLength(3);
    expect(json.plan.horizonMonths).toBe(3);
    expect(json.plan.horizonLocked).toBe(true);
    // Computed 12, returned 3 — the gap is reported honestly rather than guessed.
    expect(json.plan.horizonAvailable).toBe(12);
    // The months beyond the horizon are ABSENT, not flagged. A client cannot
    // read what was never sent.
    expect(json.plan.months[json.plan.months.length - 1].month).toBe('2026-09');
    // Same value GET /api/cards/months must return for a free household.
    expect(json.horizonEndMonth).toBe('2026-09');
  });

  it('an unreadable household row fails CLOSED to the free horizon', async () => {
    // Defaulting to Pro on a database hiccup would give the product away on
    // exactly the errors nobody notices.
    const { client } = makeSupabaseMock({
      ...baseScript,
      households: [
        { data: { timezone: 'America/Toronto' } },
        { data: null, error: { message: 'boom' } },
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&includePlan=1');
    const json = await res.json();

    expect(json.plan.months).toHaveLength(3);
    expect(json.plan.horizonLocked).toBe(true);
  });

  // THE REAL SEAM: Supabase select → toTimelineTxs → the transactions.map
  // that builds datedTransactions → buildPlanChain. The pure-function tests
  // (planChainHelpers.test.ts) hand-build correctly-shaped fixtures and
  // never exercise this path — this is what actually caught nothing, twice,
  // while the underlying math was already fixed. A raw DB row shaped
  // exactly like the real household's — a recurring, dated TRANSFER
  // contribution in the remainder of the current month — must survive the
  // whole trip and land in the returned chain.
  it('a real DB row (recurring transfer contribution, dated in the remainder of the month) survives select -> toTimelineTxs -> datedTransactions -> buildPlanChain', async () => {
    const { client } = makeSupabaseMock({
      ...baseScript,
      transactions: [
        {
          data: [
            {
              id: 'tx-1', date: '2026-07-30', description: 'Savings Bigode', amount: 350, type: 'transfer',
              recurring_item_id: 'ri-savings', recurrence_id: null, installment_label: null,
              transfer_peer_id: 'peer-1', is_bridge: false, bridge_source_account: null, bridge_source_month: null,
            },
          ],
        },
        // The other side of the transfer, read so the breakdown can classify it.
        { data: [{ id: 'peer-1', account_id: 'sav-1', type: 'transfer', amount: 350 }] },
      ],
      accounts: [
        baseScript.accounts[0],
        baseScript.accounts[1],
        { data: [{ id: 'acc-1', type: 'chequing' }, { id: 'sav-1', type: 'savings', name: 'Bigode' }] },
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const res = await getTimeline('account=acc-1&includePlan=1');
    const json = await res.json();

    expect(res.status).toBe(200);
    // A transfer contribution is an outflow — same rule the real ledger
    // walk (todayBalance itself) already applies via signAmount.
    expect(json.plan.months[0].balance).toBe(650); // 1000 - 350, not 1000
    // The same row, through the same trip, lands in the breakdown's savings
    // line — classified by its peer's account, and the sum closes.
    expect(json.plan.months[0].startBalance).toBe(1000);
    expect(json.plan.months[0].breakdown).toEqual({
      status: 'ok',
      lines: {
        income: 0, bills: 0, savings: 350, debtPayments: 0, drawn: 0, leftAfterBillsAndSavings: -350, cards: 0,
        // Named from the accounts read, for the expandable savings row.
        savingsByDestination: [{ accountId: 'sav-1', name: 'Bigode', amount: 350 }],
      },
    });
  });

  it('a month whose lines do not add up is an error for THAT month only — logged with both nets, sent with none', async () => {
    // Through this route a mismatch needs a row the classifier cannot bucket,
    // and toTimelineTxs already drops unknown types — so the detection itself
    // is pinned in planChainHelpers.test.ts (computeMonthBreakdown). Here the
    // chain is real and only August's breakdown is forced to an error, to
    // prove what the ROUTE does with one.
    vi.doMock('@/lib/planChainHelpers', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/planChainHelpers')>();
      return {
        ...actual,
        buildPlanChain: (p: Parameters<typeof actual.buildPlanChain>[0]) =>
          actual.buildPlanChain(p).map((m) =>
            m.month === '2026-08' ? { ...m, breakdown: { status: 'error' as const, linesNet: 0, chainNet: -40 } } : m
          ),
      };
    });
    const { client } = makeSupabaseMock(proScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const res = await getTimeline('account=acc-1&includePlan=1');
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.ok).toBe(true);
      const aug = json.plan.months.find((m: { month: string }) => m.month === '2026-08');
      // No figures reach the client — not the nets, not partial lines.
      expect(aug.breakdown).toEqual({ status: 'error' });
      expect(aug.balance).toBe(1000);
      const others = json.plan.months.filter((m: { month: string }) => m.month !== '2026-08');
      expect(others).toHaveLength(11);
      expect(others.every((m: { breakdown: { status: string } }) => m.breakdown.status === 'ok')).toBe(true);
      expect(errorSpy).toHaveBeenCalledWith('plan breakdown mismatch', {
        householdId: 'hh1', month: '2026-08', linesNet: 0, chainNet: -40,
      });
    } finally {
      errorSpy.mockRestore();
      vi.doUnmock('@/lib/planChainHelpers');
    }
  });

  // One planned chequing row in the given month, shaped like a DB row.
  const dbRow = (id: string, date: string, amount: number, type: string, peer: string | null = null) => ({
    id, date, description: id, amount, type, recurring_item_id: null, recurrence_id: null, installment_label: null,
    transfer_peer_id: peer, is_bridge: false, bridge_source_account: null, bridge_source_month: null,
  });

  it('a transfer to a DEBT account is a debt payment — the peer read decides, not the fallback', async () => {
    const { client } = makeSupabaseMock({
      ...proScript,
      transactions: [
        { data: [dbRow('tx-pay', '2026-08-04', 350, 'transfer', 'peer-d')] },
        { data: [{ id: 'peer-d', account_id: 'debt-1', type: 'transfer', amount: 350 }] },
      ],
      accounts: [
        baseScript.accounts[0],
        baseScript.accounts[1],
        { data: [{ id: 'acc-1', type: 'chequing' }, { id: 'debt-1', type: 'debt' }] },
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const json = await (await getTimeline('account=acc-1&includePlan=1')).json();
    const aug = json.plan.months.find((m: { month: string }) => m.month === '2026-08');
    expect(aug.breakdown.lines.debtPayments).toBe(350);
    expect(aug.breakdown.lines.savings).toBe(0);
  });

  it('the "why" line reads only the months a free household can see', async () => {
    // A $100 bill in August (visible) and a $5,000 one in December (not sent
    // to a free household). The lowest SEEN month is August.
    const { client } = makeSupabaseMock({
      ...baseScript,
      transactions: [{ data: [dbRow('tx-aug', '2026-08-04', 100, 'expense'), dbRow('tx-dec', '2026-12-04', 5000, 'expense')] }],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const json = await (await getTimeline('account=acc-1&includePlan=1')).json();
    expect(json.plan.months.map((m: { why: unknown }) => m.why)).toEqual([
      null,
      { kind: 'moreOutThanIn', amount: 100 },
      null,
    ]);
  });

  it('names an extra payment from the recurring rules it reads', async () => {
    const { client } = makeSupabaseMock({
      ...proScript,
      transactions: [{
        data: ['2026-09-01', '2026-09-15', '2026-09-29'].map((d, i) => ({
          ...dbRow(`mtg-${i}`, d, 1500, 'expense'), recurring_item_id: 'ri-mtg',
        })),
      }],
      recurring_items: [
        { data: [{ id: 'ri-mtg', description: 'Mortgage', cadence: 'biweekly', type: 'expense' }] },
        { count: 0, data: [] },
        { count: 0, data: [] },
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const json = await (await getTimeline('account=acc-1&includePlan=1')).json();
    const sep = json.plan.months.find((m: { month: string }) => m.month === '2026-09');
    expect(sep.why).toEqual({
      kind: 'extraPayments',
      items: [{ name: 'Mortgage', occurrences: 3, usualOccurrences: 2, dates: ['2026-09-01', '2026-09-15', '2026-09-29'] }],
    });
  });

  it('sends each card closed statements, from its first transaction on', async () => {
    const { client } = makeSupabaseMock({
      ...proScript,
      accounts: [
        baseScript.accounts[0],
        { data: [{ id: 'card-1', name: 'Visa', payment_day: 5, statement_close_day: 15 }] },
        { data: [{ id: 'acc-1', type: 'chequing' }, { id: 'card-1', type: 'credit_card' }] },
      ],
      monthly_goals: [{ data: [] }],
      transactions: [
        { data: [] }, // chequing
        { data: [ // card rows: the June and July statements (close day 15)
          { account_id: 'card-1', date: '2026-06-01', type: 'expense', amount: 100, category_id: null, is_bridge: false },
          { account_id: 'card-1', date: '2026-07-01', type: 'expense', amount: 200, category_id: null, is_bridge: false },
        ] },
        { data: [{ date: '2026-06-01' }] }, // the card's first transaction
      ],
    });
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const json = await (await getTimeline('account=acc-1&includePlan=1')).json();
    expect(json.plan.statementHistory).toEqual([{
      cardId: 'card-1', cardName: 'Visa', count: 2, average: 150,
      statements: [{ cycleMonth: '2026-07', total: 200 }, { cycleMonth: '2026-06', total: 100 }],
    }]);
  });

  it('sends the statement history beside the months (empty without cards)', async () => {
    const { client } = makeSupabaseMock(proScript);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const json = await (await getTimeline('account=acc-1&includePlan=1')).json();
    expect(json.plan.statementHistory).toEqual([]);
  });
});
