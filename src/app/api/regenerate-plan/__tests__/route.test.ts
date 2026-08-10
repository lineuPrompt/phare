import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Same hard gate as api/plan/route.ts, now applied to the ongoing monthly
// review: the AI must never instantiate structured objects (sinking-fund
// rows, goal cards, debt-payoff cards). These tests drive a DELIBERATELY
// MISBEHAVING AI that returns all three anyway, and prove the route ignores
// every one of them — sinking funds come from the real sinking_funds table,
// goals/debtPayoff come from real goal accounts via evaluateGoals()/
// computeDebtPayoff(), never from aiPart.

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

type Call = { table: string; method: string; args: unknown[] };

function makeSupabaseMock(script: Record<string, Resolution[]>) {
  const cursors: Record<string, number> = {};
  const calls: Call[] = [];

  function entry(table: string, method: string, args: unknown[]) {
    calls.push({ table, method, args });
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    const list = script[table] ?? [];
    if (idx >= list.length) {
      // events (review_text_guard_retried, etc.) is fire-and-forget and
      // shields its own errors — safe to leave unscripted, same convention
      // as the dashboard route's test harness.
      if (table === 'events') return makeResultChain({ data: null, error: null, count: 0 });
      // conversations is now touched TWICE per request — a select (is the cron
      // mid-generation for this month?) then the upsert. These suites are about
      // the AI guards, not persistence, so an exhausted script falls back to a
      // benign result rather than forcing every fixture to spell both out. The
      // persistence describe below scripts them explicitly.
      if (table === 'conversations') return makeResultChain({ data: null, error: null });
      throw new Error(`No scripted response for table "${table}" call #${idx + 1} (method: ${method})`);
    }
    return makeResultChain(list[idx]);
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: (...args: unknown[]) => entry(table, 'select', args),
      insert: (...args: unknown[]) => entry(table, 'insert', args),
      upsert: (...args: unknown[]) => entry(table, 'upsert', args),
    }),
  };

  return { client, calls };
}

vi.mock('@/lib/supabase-server', () => ({
  createClient: vi.fn(),
}));

const createMock = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...args: unknown[]) => createMock(...args) } },
}));

const ROGUE_PLAN_AI = {
  lineClassifications: [{ label: 'Mortgage', category: 'Housing', isFixed: true }],
  sinkingFunds: [{ name: 'Vacation fund', annualAmount: 2400, monthlyProvision: 200, dueMonth: 'July' }],
  goals: [{ name: 'Fake goal', targetAmount: 99999, monthlyContribution: 500, onTrack: true, estimatedDate: '2099-01' }],
  debtPayoff: { description: 'Made up by the model', targetDate: '2099-01', monthlyPayment: 999999 },
  topRecommendation: 'Keep it up.',
};

describe('POST /api/regenerate-plan — the AI may never instantiate structured objects', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  it('sinking funds come from the real sinking_funds table, never the AI, even when the AI returns its own', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(ROGUE_PLAN_AI) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client, calls } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        { data: [{ amount: 5000, type: 'income', description: 'Salary', account_id: 'chq-1' }], error: null },
        { data: [], error: null }, // Coaching Layer history window (typical surplus / installments)
      ],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [
        { data: [{ name: 'Property tax', annual_amount: 3600, monthly_provision: 300, due_month: 'March' }], error: null },
      ],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    expect(res.status).toBe(200);

    // The review-generation prompt (2nd AI call) carries the plan actually
    // used to persist — proving the real sinking fund reached the review,
    // and the AI's fabricated one did not.
    const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
    expect(reviewPromptSent).toContain('Property tax');
    expect(reviewPromptSent).not.toContain('Vacation fund');
    void calls;
  });

  it('goals and debtPayoff come from real goal accounts via evaluateGoals/computeDebtPayoff, never the AI', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(ROGUE_PLAN_AI) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        // Month-scoped fetch (headline figures)
        { data: [{ amount: 5000, type: 'income', description: 'Salary', account_id: 'chq-1' }], error: null },
        { data: [], error: null }, // Coaching Layer history window
        // All-time fetch for goal-account balance
        { data: [{ amount: 2000, type: 'transfer', account_id: 'goal-1', date: '2026-01-01' }], error: null },
      ],
      accounts: [
        {
          data: [
            { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null },
            { id: 'goal-1', name: 'Disney trip', type: 'savings', goal_target: 6000, goal_target_date: '2028-01-01' },
          ],
          error: null,
        },
      ],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    expect(res.status).toBe(200);

    const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
    // The real, code-computed goal made it into the review context...
    expect(reviewPromptSent).toContain('Disney trip');
    // ...the AI's fabricated goal, debt card, and absurd figures did not.
    expect(reviewPromptSent).not.toContain('Fake goal');
    expect(reviewPromptSent).not.toContain('99999');
    expect(reviewPromptSent).not.toContain('999999');
    expect(reviewPromptSent).not.toContain('Made up by the model');
  });

  it('does not request sinkingFunds, goals, or debtPayoff fields from the AI at all', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(ROGUE_PLAN_AI) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));

    const planPromptSent = createMock.mock.calls[0][0].messages[0].content as string;
    expect(planPromptSent).not.toContain('"sinkingFunds"');
    expect(planPromptSent).not.toContain('"goals"');
    expect(planPromptSent).not.toContain('"debtPayoff"');
    expect(planPromptSent).not.toContain('monthlyContribution');
  });

  it('Phase 3: an explicitly-typed debt account is detected without name matching (isDebtGoalName retired for it)', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        { data: [], error: null }, // month-scoped headline figures
        { data: [], error: null }, // Coaching Layer history window
        // All-time fetch for the debt account's balance: opened at -5000, one $200 payment.
        { data: [
          { amount: -5000, type: 'transfer', account_id: 'debt-1', date: '2026-05-01' },
          { amount: 200, type: 'transfer', account_id: 'debt-1', date: '2026-06-01' },
        ], error: null },
      ],
      accounts: [
        {
          data: [
            { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null },
            // Deliberately NOT named anything isDebtGoalName would match —
            // proves detection comes from type='debt', not the keyword heuristic.
            { id: 'debt-1', name: "Emma's line", type: 'debt', goal_target: 0, goal_target_date: '2028-01-01' },
          ],
          error: null,
        },
      ],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    expect(res.status).toBe(200);

    const planPromptSent = createMock.mock.calls[0][0].messages[0].content as string;
    // The debt account's own name reached the AI context as the debt line —
    // proof detection worked from type='debt' with no keyword in the name.
    expect(planPromptSent).toContain("Emma's line");
  });

  it('Part B.3: a goal with only future materialized contributions shows the true (unstarted) balance, not their sum', async () => {
    // The exact live bug: a TFSA with twelve future $350 contributions
    // materialized ahead of time (Phase 2) must NOT read as "$4,200
    // contributed" before a single one has actually happened.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const futureContributions = Array.from({ length: 12 }, (_, i) => {
      const monthIndex0 = 7 + i; // August 2026 onward, 0-based
      const year = 2026 + Math.floor(monthIndex0 / 12);
      const month = (monthIndex0 % 12) + 1;
      return { amount: 350, type: 'transfer', account_id: 'tfsa-1', date: `${year}-${String(month).padStart(2, '0')}-01` };
    });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        { data: [], error: null }, // month-scoped headline figures
        { data: [], error: null }, // Coaching Layer history window
        { data: futureContributions, error: null }, // all-time fetch for the goal's balance — all future
      ],
      accounts: [
        {
          data: [
            { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null },
            { id: 'tfsa-1', name: 'TFSA — Bigode e Secundario', type: 'tfsa', goal_target: 10000, goal_target_date: '2028-01-01' },
          ],
          error: null,
        },
      ],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      expect(res.status).toBe(200);

      const planPromptSent = createMock.mock.calls[0][0].messages[0].content as string;
      // savedSoFar must be 0 (nothing has happened yet as of today) —
      // never 4200 (the sum of all twelve future rows).
      expect(planPromptSent).toContain('"savedSoFar":0');
      expect(planPromptSent).not.toContain('4200');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Phase 3: recurring contributions and debt payments are narrated as already-committed, not extra room', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [
        { data: [{ amount: 500, cadence: 'monthly', accounts: { name: 'RRSP — Retraite', type: 'rrsp' } }], error: null },
        { data: [], error: null },
      ],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    expect(res.status).toBe(200);

    const planPromptSent = createMock.mock.calls[0][0].messages[0].content as string;
    expect(planPromptSent).toContain('RRSP — Retraite');
    expect(planPromptSent).toContain('already deducted');
    expect(planPromptSent).toContain('already accounted for');
  });

  it('Part B.4: a three-occurrence month flags the windfall in the review context', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        {
          data: [
            { amount: 2749, type: 'income', description: "Lineu's paycheque", account_id: 'chq-1', recurring_item_id: 'ri-1' },
            { amount: 2749, type: 'income', description: "Lineu's paycheque", account_id: 'chq-1', recurring_item_id: 'ri-1' },
            { amount: 2749, type: 'income', description: "Lineu's paycheque", account_id: 'chq-1', recurring_item_id: 'ri-1' },
          ],
          error: null,
        },
        { data: [], error: null }, // Coaching Layer history window
      ],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [
        { data: [], error: null }, // committed transfers (none)
        { data: [{ id: 'ri-1', description: "Lineu's paycheque", cadence: 'biweekly', type: 'income' }], error: null }, // active income/expense items
      ],
      conversations: [{ error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      expect(res.status).toBe(200);

      const planPromptSent = createMock.mock.calls[0][0].messages[0].content as string;
      expect(planPromptSent).toContain("Lineu's paycheque");
      expect(planPromptSent).toContain('"occurrences":3');
      expect(planPromptSent).toContain('"typicalOccurrences":2');
      expect(planPromptSent).toContain('one-time timing event');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Part B.5/B.6/B.7: reviewPrompt names the reviewed month and carries the hard anti-fabrication rules', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      expect(res.status).toBe(200);

      const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
      // B.5: the actual reviewed month (July 2026), computed from the real
      // system date, not a guess and not a leftover example month name.
      expect(reviewPromptSent).toContain('July 2026');
      expect(reviewPromptSent).not.toMatch(/\bJune\b/); // the old example's month name is gone entirely
      // B.7: no-arithmetic hard rule present.
      expect(reviewPromptSent).toContain('NO ARITHMETIC');
      // B.6: on-track hard rule present.
      expect(reviewPromptSent).toContain('ON-TRACK CLAIMS');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sinking fund review truth: unlinked funds flow into the review as one shared sinkingFundBuffer.fundedAlready:false, and the planned-not-active hard rule is present', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      // No linked_account_id for either fund — the real, live shape today
      // (the shared buffer has never been started).
      sinking_funds: [{
        data: [
          { name: 'Property tax', annual_amount: 3600, monthly_provision: 300, due_month: 3, linked_account_id: null },
          { name: 'Christmas', annual_amount: 3096, monthly_provision: 258, due_month: 12, linked_account_id: null },
        ],
        error: null,
      }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    expect(res.status).toBe(200);

    const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
    expect(reviewPromptSent).toContain('"fundedAlready":false');
    expect(reviewPromptSent).toContain('"totalMonthlyProvision":558'); // 300 + 258, summed once, never by the AI
    // Renamed from SINKING FUNDS (2026-08-01): the prompt writes prose the
    // family reads, so its vocabulary tracks the UI's.
    expect(reviewPromptSent).toContain('RESERVE FUNDS');
    expect(reviewPromptSent).toContain('ZERO-BALANCE GOALS');
  });

  it('sinking fund review truth: every fund sharing a linked account with a real positive balance flows as ONE sinkingFundBuffer.fundedAlready:true', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        { data: [], error: null }, // month-scoped headline figures
        { data: [], error: null }, // Coaching Layer history window
        { // all-time fetch for the shared buffer's balance
          data: [{ amount: 900, type: 'transfer', account_id: 'buffer-1', date: '2020-01-01' }],
          error: null,
        },
      ],
      accounts: [{
        data: [
          { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null },
          { id: 'buffer-1', name: 'Sinking funds', type: 'savings', goal_target: null, goal_target_date: null, is_sinking_fund: true },
        ],
        error: null,
      }],
      sinking_funds: [{
        data: [
          { name: 'Property tax', annual_amount: 3600, monthly_provision: 300, due_month: 3, linked_account_id: 'buffer-1' },
          { name: 'Christmas', annual_amount: 3096, monthly_provision: 258, due_month: 12, linked_account_id: 'buffer-1' },
        ],
        error: null,
      }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    expect(res.status).toBe(200);

    const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
    expect(reviewPromptSent).toContain('"fundedAlready":true');
    // Neither individual fund entry carries its own fundedAlready any more —
    // it is a single shared signal, not a per-fund one.
    expect(reviewPromptSent).not.toMatch(/"dueMonth":3,"fundedAlready"/);
  });
});

// ---------------------------------------------------------------------------
// ONE REVIEW PER MONTH. A refresh now writes into the same
// (household_id, review_month) slot the cron uses, so what it targets and what
// it replaces are load-bearing.
// ---------------------------------------------------------------------------
describe('POST /api/regenerate-plan — persistence', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
    vi.useFakeTimers();
    // Mid-August. The month in progress is 2026-08; the last completed one is
    // 2026-07, and targeting that would ignore an August correction.
    vi.setSystemTime(new Date('2026-08-14T12:00:00'));
  });

  afterEach(() => { vi.useRealTimers(); });

  function baseScript(conversations: Resolution[]) {
    return {
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
        { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
        { data: { timezone: 'America/Toronto' }, error: null },
      ],
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations,
    };
  }

  async function post(conversations: Resolution[]) {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A steady month.' }] });

    const { client, calls } = makeSupabaseMock(baseScript(conversations));
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    return { res, calls };
  }

  it('targets the month IN PROGRESS, not the last completed one', async () => {
    const { res } = await post([{ data: null, error: null }, { error: null }]);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.reviewMonth).toBe('2026-08');
    // The letter itself is about August too — the prompt pins it.
    const reviewPrompt = createMock.mock.calls[1][0].messages[0].content as string;
    expect(reviewPrompt).toContain('August 2026');
    expect(reviewPrompt).not.toContain('July 2026');
  });

  it('UPSERTS on (household_id, review_month) and marks the row manual', async () => {
    const { calls } = await post([{ data: null, error: null }, { error: null }]);

    const upsert = calls.find((c) => c.table === 'conversations' && c.method === 'upsert');
    expect(upsert, 'no upsert issued').toBeTruthy();

    const [row, options] = upsert!.args as [Record<string, unknown>, Record<string, unknown>];
    expect(row.review_month).toBe('2026-08');
    expect(row.generated_by).toBe('manual');
    // Inferrable only against a TOTAL unique index — a partial one makes
    // Postgres reject this outright.
    expect(options.onConflict).toBe('household_id,review_month');
    // The displayed date must be when this text was written, not when the row
    // it replaced was first inserted.
    expect(String(row.created_at).startsWith('2026-08-14')).toBe(true);
  });

  it('REFUSES while the cron holds an empty claim for that month', async () => {
    const { res, calls } = await post([
      { data: { id: 'claim-1', messages: [] }, error: null },
    ]);
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.code).toBe('review_in_progress');
    // Nothing was generated and nothing was written — the letter the cron is
    // about to produce is not at risk.
    expect(createMock).not.toHaveBeenCalled();
    expect(calls.some((c) => c.method === 'upsert')).toBe(false);
  });

  it('the refusal costs no refresh — it happens before the quota is reserved', async () => {
    const { calls } = await post([
      { data: { id: 'claim-1', messages: [] }, error: null },
    ]);
    // reserveRegeneration reads/writes events; a refused request must not.
    expect(calls.some((c) => c.table === 'events')).toBe(false);
  });

  it('an EXISTING FILLED review for the month is replaced, not refused', async () => {
    // That is the whole point: correct an entry, regenerate, get the corrected
    // letter. Only an EMPTY claim means "the cron is mid-write".
    const { res } = await post([
      { data: { id: 'prev', messages: [{ type: 'monthly_review', content: 'old' }] }, error: null },
      { error: null },
    ]);
    expect(res.status).toBe(200);
  });

  it('surfaces a save failure instead of reporting success', async () => {
    const { res } = await post([
      { data: null, error: null },
      { error: { message: 'conflict' } },
    ]);
    expect(res.status).toBe(500);
  });
});

describe('POST /api/regenerate-plan — the Coaching Layer', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  it('prioritization: a past-due goal ranks first even against a sinking fund due sooner on the calendar', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        { data: [], error: null }, // month-scoped headline figures
        { data: [], error: null }, // Coaching Layer history window
        { data: [], error: null }, // all-time fetch for the goal's balance (savedSoFar: 0)
      ],
      accounts: [{
        data: [
          { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null },
          // Target date already passed relative to "today" (2026-07-17).
          { id: 'goal-1', name: 'Emergency fund', type: 'savings', goal_target: 2000, goal_target_date: '2026-01-01' },
        ],
        error: null,
      }],
      sinking_funds: [{
        data: [
          // Due next month — nearer on the calendar than the goal's (already
          // passed) date, but must NOT outrank the past-due goal.
          { name: 'Christmas fund', annual_amount: 3600, monthly_provision: 300, due_month: 8, due_day: 15, linked_account_id: null },
        ],
        error: null,
      }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      expect(res.status).toBe(200);

      const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
      // The past-due goal is the FIRST element of coaching.rankedNeeds.
      expect(reviewPromptSent).toContain('"rankedNeeds":[{"kind":"goal","name":"Emergency fund"');
      expect(reviewPromptSent).toContain('"pastDue":true');
      expect(reviewPromptSent).toContain('COACHING');
    } finally {
      vi.useRealTimers();
    }
  });

  it('sourcing: only the card category that actually exceeds its own target reaches coaching.sourceCategory, never one under/at target', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        {
          data: [
            { account_id: 'card-1', amount: 350, type: 'expense', category_id: 'cat-hobby', date: '2026-07-05', is_bridge: false, description: 'Hobby stuff' },
            { account_id: 'card-1', amount: 80, type: 'expense', category_id: 'cat-book', date: '2026-07-06', is_bridge: false, description: 'Book club dues' },
          ],
          error: null,
        },
        {
          // Coaching Layer history window — this is what the card-envelope
          // over-target check reads from (2026-07-31: moved off the narrower
          // current-month-only query above so a live cycle spanning a
          // calendar-month edge is never missed); same two card transactions,
          // since a real DB query for either range would return both.
          data: [
            { account_id: 'card-1', amount: 350, type: 'expense', category_id: 'cat-hobby', date: '2026-07-05', is_bridge: false },
            { account_id: 'card-1', amount: 80, type: 'expense', category_id: 'cat-book', date: '2026-07-06', is_bridge: false },
          ],
          error: null,
        },
      ],
      accounts: [{
        data: [
          { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null },
          { id: 'card-1', name: 'Visa', type: 'credit_card', goal_target: null, goal_target_date: null, statement_close_day: null },
        ],
        error: null,
      }],
      sinking_funds: [{ data: [], error: null }],
      card_envelope_items: [{
        data: [
          // Over its own $200 target.
          { category_id: 'cat-hobby', monthly_amount: 200, categories: { name: 'Hobby Supplies', name_fr: null } },
          // Under its own $100 target — must never surface as a source.
          { category_id: 'cat-book', monthly_amount: 100, categories: { name: 'Book Club', name_fr: null } },
        ],
        error: null,
      }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      expect(res.status).toBe(200);

      const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
      expect(reviewPromptSent).toContain('"sourceCategory":{"categoryName":"Hobby Supplies","target":200,"actual":350,"over":150}');
      // The under-target category never reaches the AI's context at all —
      // there is no path for it to appear, structurally, not just by rule.
      expect(reviewPromptSent).not.toContain('Book Club');
    } finally {
      vi.useRealTimers();
    }
  });

  it('empty-set fallback: fallbackApplies is true and the meaning-based hard rule is present when there is genuinely nothing to point to', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      // No income/expenses this month or in the trailing history — typical
      // surplus computes to exactly 0, no card accounts, no sinking funds,
      // no goals: nothing real to point to anywhere.
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      expect(res.status).toBe(200);

      const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
      expect(reviewPromptSent).toContain('"fallbackApplies":true');
      expect(reviewPromptSent).toContain('coaching.fallbackApplies');
      expect(reviewPromptSent).toContain('never substitute a vaguer instruction like "look at your spending,"');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a misbehaving AI cannot inject a fabricated coaching object — the real plan.coaching is entirely code-computed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    const ROGUE_COACHING_AI = {
      lineClassifications: [],
      topRecommendation: 'Keep going.',
      // None of this is ever read by the route — coaching is assembled
      // entirely from coachingHelpers.ts, never from aiPart.
      coaching: {
        sourceCategory: { categoryName: 'Fake Category', target: 1, actual: 99999, over: 99998 },
        rankedNeeds: [{ kind: 'goal', name: 'Fake need', monthlyPressure: 99999 }],
        startingContribution: 99999,
        fallbackApplies: false,
      },
    };

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(ROGUE_COACHING_AI) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      expect(res.status).toBe(200);

      const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
      expect(reviewPromptSent).not.toContain('Fake Category');
      expect(reviewPromptSent).not.toContain('Fake need');
      expect(reviewPromptSent).not.toContain('99999');
      expect(reviewPromptSent).not.toContain('99998');
      // The real, code-computed fallback (nothing set up at all) reached the review instead.
      expect(reviewPromptSent).toContain('"fallbackApplies":true');
    } finally {
      vi.useRealTimers();
    }
  });
});

// Fix 1 (2026-07-27): plan.topRecommendation is generated by planPrompt — an
// older AI call, separate from the Coaching Layer's reviewPrompt, never wired
// into it. Confirmed live: across two real regenerate-plan runs for the same
// household/month/credit line (whose own required payment is a fixed
// computedDebtPayoff.monthlyPayment), the model stated two different dollar
// figures for it. enforceDebtFigureInTopRecommendation (topRecommendationHelpers.ts)
// closes this structurally: either the model uses the required placeholder
// (substituted with the real figure) or it doesn't (in which case the whole
// recommendation is replaced with a deterministic, code-built one) — the
// final shipped figure can never be an AI-invented number.
describe('POST /api/regenerate-plan — Fix 1: topRecommendation debt-figure enforcement', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  // Debt account: opening -$6000 (2026-01-01, before "today"), target 0,
  // target date 2027-01-17 — 6 months from "today" (2026-07-17) — giving a
  // clean, hand-computable requiredMonthlyContribution of exactly $1000/mo.
  const debtFixture = {
    users: [{ data: { household_id: 'hh1' }, error: null }],
    households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
    transactions: [
      { data: [], error: null }, // month-scoped headline figures
      { data: [], error: null }, // Coaching Layer history window
      { data: [{ amount: -6000, type: 'transfer', account_id: 'debt-1', date: '2026-01-01' }], error: null }, // all-time debt balance
    ],
    accounts: [{
      data: [
        { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null },
        { id: 'debt-1', name: 'Credit Line', type: 'debt', goal_target: 0, goal_target_date: '2027-01-17' },
      ],
      error: null,
    }],
    sinking_funds: [{ data: [], error: null }],
    recurring_items: [{ data: [], error: null }, { data: [], error: null }],
    conversations: [{ error: null }],
  };

  it('substitutes the placeholder with the real computed monthly payment when the AI uses it correctly', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [],
        topRecommendation: 'Focus on Credit Line — put {{DEBT_PAYMENT}}/month toward it to stay on track.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock(debtFixture);

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.topRecommendation).toBe('Focus on Credit Line — put $1000.00/month toward it to stay on track.');
      expect(json.topRecommendation).not.toContain('{{DEBT_PAYMENT}}');
    } finally {
      vi.useRealTimers();
    }
  });

  it('corrects a fabricated dollar figure when the AI ignores the placeholder — the confirmed live failure mode', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [],
        topRecommendation: 'With your credit line targeted for payoff, aim to apply at least $3,000 of it this month.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock(debtFixture);

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.topRecommendation).not.toContain('3,000');
      expect(json.topRecommendation).not.toContain('3000');
      expect(json.topRecommendation).toContain('$1000.00');
      expect(json.topRecommendation).toContain('Credit Line');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is deterministic: two separately-run fabricated figures for the same debt correct to the identical final value', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    // Run A — the model states "$833".
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [],
        topRecommendation: 'Direct $833 toward Credit Line this month.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });
    const { client: clientA } = makeSupabaseMock(debtFixture);

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(clientA);
      const { POST: postA } = await import('../route');
      const resA = await postA(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      const jsonA = await resA.json();

      // Run B — same debt, same household shape, but the model states "$3,000" instead.
      vi.resetModules();
      createMock.mockReset();
      createMock
        .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
          lineClassifications: [],
          topRecommendation: 'Put at least $3,000 toward Credit Line this month.',
        }) }] })
        .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });
      const { client: clientB } = makeSupabaseMock(debtFixture);
      const { createClient: createClientB } = await import('@/lib/supabase-server');
      (createClientB as ReturnType<typeof vi.fn>).mockResolvedValue(clientB);
      const { POST: postB } = await import('../route');
      const resB = await postB(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      const jsonB = await resB.json();

      expect(resA.status).toBe(200);
      expect(resB.status).toBe(200);
      // Two different AI-invented figures for the same real debt converge on
      // the exact same corrected recommendation — no more run-to-run drift.
      expect(jsonA.topRecommendation).toBe(jsonB.topRecommendation);
      expect(jsonA.topRecommendation).toContain('$1000.00');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves topRecommendation untouched when there is no debt at all', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [],
        topRecommendation: 'Your Shopping category ran $200 over this month — worth a look.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.topRecommendation).toBe('Your Shopping category ran $200 over this month — worth a look.');
  });
});

// Fix 2 (2026-07-27): not a bug — typicalSurplus: 0 for a household with
// fewer than 3 real trailing months is correct, defined behavior
// (computeMonthTotals([], accounts) legitimately returns all-zero). The gap
// is coherence: fallbackApplies stays false whenever a real sourceCategory
// or freedCapacityEvent exists (its own, different, correctly-scoped
// condition), so the review had no signal to explain WHY a strong current
// month produced a $0 starting recommendation. coaching.insufficientHistory
// is a separate, independent signal for exactly that gap.
describe('POST /api/regenerate-plan — Fix 2: coaching.insufficientHistory', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  it('is true even when a real sourceCategory AND freedCapacityEvents exist — independent of fallbackApplies', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        // Month-scoped headline: real card spend, over its own target.
        {
          data: [
            { account_id: 'card-1', amount: 350, type: 'expense', category_id: 'cat-hobby', date: '2026-07-05', is_bridge: false, description: 'Hobby stuff' },
          ],
          error: null,
        },
        {
          // Coaching Layer history window — this is what the card-envelope
          // over-target check now reads from (2026-07-31); "0 of 3 months
          // have data" for the typical-surplus average still holds (that's
          // computed from a separate monthly slice below, not from whether
          // this array is empty) — this real July card transaction must be
          // present here for the coaching check itself to see it.
          data: [
            { account_id: 'card-1', amount: 350, type: 'expense', category_id: 'cat-hobby', date: '2026-07-05', is_bridge: false },
          ],
          error: null,
        },
        { data: [{ amount: -6000, type: 'transfer', account_id: 'debt-1', date: '2026-01-01' }], error: null }, // all-time debt balance
      ],
      accounts: [{
        data: [
          { id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null },
          { id: 'card-1', name: 'Visa', type: 'credit_card', goal_target: null, goal_target_date: null, statement_close_day: null },
          { id: 'debt-1', name: 'Credit Line', type: 'debt', goal_target: 0, goal_target_date: '2027-01-17' },
        ],
        error: null,
      }],
      sinking_funds: [{ data: [], error: null }],
      card_envelope_items: [{
        data: [
          { category_id: 'cat-hobby', monthly_amount: 200, categories: { name: 'Hobby Supplies', name_fr: null } },
        ],
        error: null,
      }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      expect(res.status).toBe(200);

      const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
      // Both real signals are present...
      expect(reviewPromptSent).toContain('"sourceCategory":{"categoryName":"Hobby Supplies"');
      expect(reviewPromptSent).toContain('"kind":"debtPayoff"');
      // ...so fallbackApplies is correctly false...
      expect(reviewPromptSent).toContain('"fallbackApplies":false');
      // ...yet insufficientHistory is still true, independently.
      expect(reviewPromptSent).toContain('"insufficientHistory":true');
      expect(reviewPromptSent).toContain('coaching.insufficientHistory');
    } finally {
      vi.useRealTimers();
    }
  });

  it('is false when all 3 trailing months have real transaction data', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-17T12:00:00'));

    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        { data: [], error: null }, // month-scoped headline figures
        {
          // Real chequing activity in each of the 3 trailing months (April, May, June 2026).
          data: [
            { amount: 2000, type: 'income', account_id: 'chq-1', date: '2026-04-10', recurring_item_id: null },
            { amount: 2000, type: 'income', account_id: 'chq-1', date: '2026-05-10', recurring_item_id: null },
            { amount: 2000, type: 'income', account_id: 'chq-1', date: '2026-06-10', recurring_item_id: null },
          ],
          error: null,
        },
      ],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    try {
      const { createClient } = await import('@/lib/supabase-server');
      (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

      const { POST } = await import('../route');
      const res = await POST(new Request('http://localhost/api/regenerate-plan', {
        method: 'POST',
        body: JSON.stringify({ locale: 'en' }),
      }));
      expect(res.status).toBe(200);

      const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
      expect(reviewPromptSent).toContain('"insufficientHistory":false');
    } finally {
      vi.useRealTimers();
    }
  });
});

// Adversarial-review Fix 2 (2026-07-28): the RESERVE FUNDS rule (real, since
// before the Coaching Layer) and the COACHING cap rule were never reconciled
// — confirmed live: with startingContribution:0, reviewText reliably (3/3
// live runs) recommended the fund's own $300 monthlyProvision, because the
// sinking-funds rule's own template phrasing has no reference to the cap.
// Founder's product decision: this is CORRECT, not a bug — monthlyProvision
// is the plan's own established figure, not a discretionary AI suggestion.
// The fix reconciles the two rules explicitly rather than leaving it an
// accident. This test pins the prompt text carries both halves of the
// reconciliation; live model behavior is verified separately (not a
// deterministic assertion, since reviewText is free-form prose).
describe('POST /api/regenerate-plan — Adversarial Fix 2: sinking-funds rule reconciled with coaching cap', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  it('reviewPrompt states monthlyProvision may be restated regardless of startingContribution, and scopes the cap to discretionary extra amounts only', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    expect(res.status).toBe(200);

    const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
    // The RESERVE FUNDS rule now cross-references the cap explicitly.
    expect(reviewPromptSent).toContain('regardless of');
    expect(reviewPromptSent).toContain('"coaching.startingContribution"');
    // The COACHING rule now states the scope boundary explicitly.
    expect(reviewPromptSent).toContain('SCOPE OF THE CAP');
    expect(reviewPromptSent).toContain('DISCRETIONARY');
    expect(reviewPromptSent).toContain('not a new suggestion');
  });
});

// Adversarial-review Fix 3 (2026-07-28): plan.seedCategories/monthlyBudget.
// categories reach reviewPrompt regardless of coaching.sourceCategory — a
// confirmed, real (though not yet observed exploited) leak. Post-generation
// guard: retry once if an unsanctioned category is used as a money source;
// deterministic fallback if the retry also fails.
describe('POST /api/regenerate-plan — Adversarial Fix 3: category-sourcing guard', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  const noCardFixture = {
    users: [{ data: { household_id: 'hh1' }, error: null }],
    households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
    transactions: [{ data: [], error: null }, { data: [], error: null }],
    accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
    sinking_funds: [{ data: [], error: null }],
    recurring_items: [{ data: [], error: null }, { data: [], error: null }],
    conversations: [{ error: null }],
  };

  it('retries once when the first attempt names an unsanctioned category as a source, and uses the clean retry', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: "There's room to work with this month — that could come from Shopping if you wanted." }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine, clean month overall.' }] });

    const { client } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('A fine, clean month overall.');
  });

  it('falls back to deterministic text when BOTH attempts name an unsanctioned category as a source', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: "That could come from Shopping if you wanted." }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: "You could also pull from Shopping this time." }] });

    const { client } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Only 3 total AI calls — plan + 2 review attempts — never a 3rd retry.
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).not.toContain('Shopping');
    expect(json.reviewText).toContain("couldn't be generated safely");
  });

  it('never retries when the first attempt is already clean — the common case stays a single review call', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall, nothing to flag.' }] });

    const { client } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(json.reviewText).toBe('A fine month overall, nothing to flag.');
  });

  it('reviewPrompt carries the NO INVENTED TARGETS rule', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    expect(res.status).toBe(200);

    const reviewPromptSent = createMock.mock.calls[1][0].messages[0].content as string;
    expect(reviewPromptSent).toContain('NO INVENTED TARGETS');
    expect(reviewPromptSent).toContain('never describe any category, fund, or line as having a "budget," "target," or');
  });

  it('FR: retries once when the first attempt names an unsanctioned category as a source in French, and uses the clean retry', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Continuez.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Vous pourriez puiser dans Shopping si vous le souhaitez.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Un mois clair et simple.' }] });

    const { client } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'fr' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('Un mois clair et simple.');
  });

  it('FR CONTROL: a genuine French sourcing phrase followed much later by an unrelated neutral mention of a category never triggers a retry', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Continuez.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Vous pourriez puiser dans vos économies avant la fin du mois, et Shopping reste stable dernièrement.' }] });

    const { client } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'fr' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(2); // no retry — not a false positive
    expect(json.reviewText).toBe('Vous pourriez puiser dans vos économies avant la fin du mois, et Shopping reste stable dernièrement.');
  });
});

// Final review bugfix 1 (2026-07-29): findUnsanctionedSourcingMention was
// called with SEED_CATEGORIES only — never the retained category line
// labels (category.name, e.g. "Winners") that buildReviewPayload deliberately
// keeps for every category. coachingHelpers.ts's own module note documents
// this guard as load-bearing against exactly that surface, but the guard was
// never given it, so an unsanctioned LINE LABEL used as a money source could
// never be caught. Fixed by passing retainedCategoryLineLabels alongside
// SEED_CATEGORIES at the checkReviewGuards call site.
describe('POST /api/regenerate-plan — Final review bugfix 1: unsanctioned line-label sourcing is now caught', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  // "Museum Membership" is a real expense line label — not one of
  // SEED_CATEGORIES, and not coaching.sourceCategory (there is no card
  // account here, so sourceCategory is null) — exactly the surface the bug
  // left unguarded.
  const lineLabelFixture = {
    users: [{ data: { household_id: 'hh1' }, error: null }],
    households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
    transactions: [
      { data: [{ amount: 600, type: 'expense', description: 'Museum Membership', account_id: 'chq-1' }], error: null },
      { data: [], error: null }, // Coaching Layer history window
    ],
    accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
    sinking_funds: [{ data: [], error: null }],
    recurring_items: [{ data: [], error: null }, { data: [], error: null }],
    conversations: [{ error: null }],
  };

  it('retries once when the first attempt names an unsanctioned LINE LABEL (not a seed category) as a source', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [{ label: 'Museum Membership', category: 'Unexpected', isFixed: false }],
        topRecommendation: 'Keep going.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'You could pull from Museum Membership this month.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine, clean month overall.' }] });

    const { client } = makeSupabaseMock(lineLabelFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    // A retry only happens if the guard actually caught it — before the fix,
    // this shipped unchanged with no retry at all.
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('A fine, clean month overall.');
  });

  it('FR: retries once when the first attempt names an unsanctioned line label as a source in French', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [{ label: 'Museum Membership', category: 'Unexpected', isFixed: false }],
        topRecommendation: 'Continuez.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Vous pourriez puiser dans Museum Membership.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Un mois clair et simple.' }] });

    const { client } = makeSupabaseMock(lineLabelFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'fr' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('Un mois clair et simple.');
  });
});

// Final review bugfix 2 (2026-07-29): realEntityNames (the allow-list for
// containsIllustrativeTokenLeak's "{name}"-shaped token exemption) was built
// from sinking funds, goals, and debt only — omitting coaching.sourceCategory
// and the retained category line labels. A household with a category
// literally named "{name}" had a perfectly valid review discarded and
// replaced with the generic safety fallback. Fixed by adding both to
// realEntityNames' construction.
describe('POST /api/regenerate-plan — Final review bugfix 2: a category literally named "{name}" is no longer a false leak', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  const braceCategoryFixture = {
    users: [{ data: { household_id: 'hh1' }, error: null }],
    households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
    transactions: [
      { data: [{ amount: 500, type: 'expense', description: '{name}', account_id: 'chq-1' }], error: null },
      { data: [], error: null }, // Coaching Layer history window
    ],
    accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
    sinking_funds: [{ data: [], error: null }],
    recurring_items: [{ data: [], error: null }, { data: [], error: null }],
    conversations: [{ error: null }],
  };

  it('a review mentioning the real category "{name}" passes through untouched — no retry', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [{ label: '{name}', category: 'Unexpected', isFixed: false }],
        topRecommendation: 'Keep going.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'You spent $500 at {name} this month, worth watching next month.' }] });

    const { client } = makeSupabaseMock(braceCategoryFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Real category name matching an illustrative token shape — exempt, no retry.
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(json.reviewText).toBe('You spent $500 at {name} this month, worth watching next month.');
  });

  // A genuine leak (no matching real entity anywhere) is still caught — this
  // is not a new test (see "reviewText illustrative single-brace token leak"
  // below, e.g. the "{month}" and "{need}" cases), but restated here directly
  // beside the fix so the two behaviors — real name passes, genuine leak
  // still caught — are visibly paired in one place.
  it('a genuine token leak with NO matching real entity is still caught, in the same household shape', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [{ label: '{name}', category: 'Unexpected', isFixed: false }],
        topRecommendation: 'Keep going.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Your plan sets aside $300/month for {month}, so plan around it.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine, clean month overall.' }] });

    const { client } = makeSupabaseMock(braceCategoryFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('A fine, clean month overall.');
  });
});

// Adversarial-review Fix 4 (2026-07-28): borrowed cash mislabeled as surplus
// when NO debt-payoff card exists at all — confirmed as a real open gap
// (no reproduction attempted at the time). The guard must engage purely off
// totalBorrowed, never gated on computedDebtPayoff existing.
describe('POST /api/regenerate-plan — Adversarial Fix 4: borrowed cash framing, no debt-payoff card', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  it('corrects a topRecommendation that labels a $1,000 credit-line draw as surplus, with no debt account anywhere', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [],
        topRecommendation: 'Your $1,000 line-of-credit draw gives you $1,000 of surplus to invest.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        {
          data: [
            { amount: 2000, type: 'income', description: 'Salary', account_id: 'chq-1' },
            { amount: 1800, type: 'expense', description: 'Rent', account_id: 'chq-1' },
            // Credit-line draw: chequing-side transfer, NEGATIVE amount — no
            // destination debt account exists anywhere in this fixture, so
            // computedDebtPayoff is null. The guard must still engage.
            { amount: -1000, type: 'transfer', description: 'Line of credit draw', account_id: 'chq-1', transfer_peer_id: 'peer-1', id: 'tx-1' },
          ],
          error: null,
        },
        { data: [], error: null }, // Coaching Layer history window
      ],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.topRecommendation).not.toContain('surplus to invest');
    expect(json.topRecommendation).toContain('$1000.00');
    expect(json.topRecommendation).toContain('borrowed');
  });

  it('FR: corrects a topRecommendation that labels a $1,000 credit-line draw as "liquidités supplémentaires", with no debt account anywhere', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [],
        topRecommendation: '1 000 $ de liquidités supplémentaires à investir ce mois-ci.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Un mois clair et simple.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [
        {
          data: [
            { amount: 2000, type: 'income', description: 'Salary', account_id: 'chq-1' },
            { amount: 1800, type: 'expense', description: 'Rent', account_id: 'chq-1' },
            { amount: -1000, type: 'transfer', description: 'Line of credit draw', account_id: 'chq-1', transfer_peer_id: 'peer-1', id: 'tx-1' },
          ],
          error: null,
        },
        { data: [], error: null },
      ],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'fr' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.topRecommendation).not.toContain('liquidités supplémentaires');
    expect(json.topRecommendation).toContain('1000.00');
    expect(json.topRecommendation).toContain('emprunt');
  });

  it('leaves topRecommendation unchanged when nothing was borrowed this month', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({
        lineClassifications: [],
        topRecommendation: 'Your $200 net cash flow this month is a solid, real gain.',
      }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
      transactions: [{ data: [], error: null }, { data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }, { data: [], error: null }],
      conversations: [{ error: null }],
    });

    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.topRecommendation).toBe('Your $200 net cash flow this month is a solid, real gain.');
  });
});

// Follow-up (2026-07-28): reviewText previously had NO visibility into
// totalBorrowed at all (plan never carried it) — now it does, via
// coaching.totalBorrowed, guarded by the SAME unified retry loop as the
// category-sourcing guard (one retry cycle evaluates both checks together,
// never two sequential cycles). Borrowed-cash mislabeling takes priority
// for which fallback ships if both checks still fail after the retry.
describe('POST /api/regenerate-plan — reviewText borrowed-cash guard (unified retry with Fix 3)', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  const drawFixture = {
    users: [{ data: { household_id: 'hh1' }, error: null }],
    households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
    transactions: [
      {
        data: [
          { amount: 2000, type: 'income', description: 'Salary', account_id: 'chq-1' },
          { amount: 1800, type: 'expense', description: 'Rent', account_id: 'chq-1' },
          { amount: -1000, type: 'transfer', description: 'Line of credit draw', account_id: 'chq-1', transfer_peer_id: 'peer-1', id: 'tx-1' },
        ],
        error: null,
      },
      { data: [], error: null },
    ],
    accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
    sinking_funds: [{ data: [], error: null }],
    recurring_items: [{ data: [], error: null }, { data: [], error: null }],
    conversations: [{ error: null }],
  };

  it('retries once when reviewText mislabels borrowed cash as surplus, and uses the clean retry', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Your $1,000 line-of-credit draw gives you $1,000 of surplus to invest.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine, clean month overall.' }] });

    const { client, calls } = makeSupabaseMock(drawFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('A fine, clean month overall.');

    const eventCall = calls.find(
      (c) => c.table === 'events' && c.method === 'insert' &&
             (c.args[0] as { event_type?: string })?.event_type === 'review_text_guard_retried'
    );
    expect(eventCall).toBeTruthy();
    const eventPayload = eventCall!.args[0] as { event_type: string; metadata: { triggeredBy: string[]; outcome: string } };
    expect(eventPayload.event_type).toBe('review_text_guard_retried');
    expect(eventPayload.metadata.triggeredBy).toEqual(['borrowed_cash']);
    expect(eventPayload.metadata.outcome).toBe('retry_passed');
  });

  it('falls back to the deterministic borrowed-cash text when BOTH attempts mislabel it', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Your $1,000 draw gives you $1,000 of surplus to invest.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'You have an extra $1,000 available this month to put toward your goals.' }] });

    const { client, calls } = makeSupabaseMock(drawFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    // Only 3 total AI calls — plan + 2 review attempts — never a 3rd retry.
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).not.toContain('surplus');
    expect(json.reviewText).toContain('$1000.00');
    expect(json.reviewText).toContain('borrowed');

    const eventCall = calls.find(
      (c) => c.table === 'events' && c.method === 'insert' &&
             (c.args[0] as { event_type?: string })?.event_type === 'review_text_guard_retried'
    );
    const eventPayload = eventCall!.args[0] as { metadata: { outcome: string } };
    expect(eventPayload.metadata.outcome).toBe('fallback_borrowed');
  });

  it('control: an honest borrowed-cash disclosure passes through untouched, no retry', async () => {
    const honestText = 'Part of this month\'s cash — $1,000 — was borrowed from your credit line, not earned.';
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: honestText }] });

    const { client } = makeSupabaseMock(drawFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(2); // no retry
    expect(json.reviewText).toBe(honestText);
  });

  it('catches a repeated figure — the same amount honestly disclosed once and mislabeled once in the same text', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Part of this month\'s cash — $1,000 — was borrowed from your credit line, not earned, but that still gives you $1,000 of surplus to work with.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine, clean month overall.' }] });

    const { client } = makeSupabaseMock(drawFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3); // caught, retried
    expect(json.reviewText).toBe('A fine, clean month overall.');
  });

  it('catches the mislabeling in French currency formatting too', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Continuez.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Vous avez 1000$ de surplus supplémentaire à investir ce mois-ci.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Un mois clair et simple.' }] });

    const { client } = makeSupabaseMock(drawFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'fr' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('Un mois clair et simple.');
  });

  it('priority: when the retry still fails BOTH checks, the borrowed-cash fallback wins over the category fallback', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'That could come from Shopping if you wanted.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'That could come from Shopping, and your $1,000 draw gives you $1,000 of surplus.' }] });

    const { client } = makeSupabaseMock(drawFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3); // never a 3rd retry
    expect(json.reviewText).toContain('borrowed');
    expect(json.reviewText).not.toContain("couldn't be generated safely");
  });
});

// Follow-up (2026-07-28): reviewText's checkReviewGuards gained a third
// condition — a leaked {{...}} template token — added defensively (no real
// double-brace instruction reaches reviewPrompt today; reviewPrompt's own
// single-brace illustrative examples are a related but different, unfixed
// risk, reported separately). Same shared retry loop, same fallback
// (buildFallbackReviewText), stated priority: borrowed_cash > token_leak >
// category_sourcing.
describe('POST /api/regenerate-plan — reviewText token-leak guard (third condition, same loop)', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  const noCardFixture = {
    users: [{ data: { household_id: 'hh1' }, error: null }],
    households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
    transactions: [{ data: [], error: null }, { data: [], error: null }],
    accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
    sinking_funds: [{ data: [], error: null }],
    recurring_items: [{ data: [], error: null }, { data: [], error: null }],
    conversations: [{ error: null }],
  };

  it('retries once when reviewText leaks a template token, and uses the clean retry', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Consider putting {{EXTRA_ROOM}} toward your goals this month.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine, clean month overall.' }] });

    const { client, calls } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('A fine, clean month overall.');

    const eventCall = calls.find(
      (c) => c.table === 'events' && c.method === 'insert' &&
             (c.args[0] as { event_type?: string })?.event_type === 'review_text_guard_retried'
    );
    const eventPayload = eventCall!.args[0] as { metadata: { triggeredBy: string[]; outcome: string } };
    expect(eventPayload.metadata.triggeredBy).toEqual(['token_leak']);
    expect(eventPayload.metadata.outcome).toBe('retry_passed');
  });

  it('falls back to deterministic text when a repeated token leaks on both attempts', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Put {{EXTRA_ROOM}} here and {{EXTRA_ROOM}} there too.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Still {{ANOTHER_TOKEN}} leaking on the retry.' }] });

    const { client, calls } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3); // never a 3rd retry
    expect(json.reviewText).not.toContain('{{');
    expect(json.reviewText).toContain("couldn't be generated safely");

    const eventCall = calls.find(
      (c) => c.table === 'events' && c.method === 'insert' &&
             (c.args[0] as { event_type?: string })?.event_type === 'review_text_guard_retried'
    );
    const eventPayload = eventCall!.args[0] as { metadata: { outcome: string } };
    expect(eventPayload.metadata.outcome).toBe('fallback_token');
  });

  it('catches the leak in French too', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Continuez.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Mettez {{MONTANT_SUPPLEMENTAIRE}} de côté ce mois-ci.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Un mois clair et simple.' }] });

    const { client } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'fr' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('Un mois clair et simple.');
  });

  it('priority: a token leak beats a category-sourcing violation when both fail on retry', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'That could come from Shopping if you wanted.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'That could come from Shopping, and also {{EXTRA_ROOM}} if available.' }] });

    const { client, calls } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.reviewText).toContain("couldn't be generated safely");

    // Both fallbacks share the same generic text, but the outcome field
    // must record token_leak as the deciding reason, not category_sourcing.
    const eventCall = calls.find(
      (c) => c.table === 'events' && c.method === 'insert' &&
             (c.args[0] as { event_type?: string })?.event_type === 'review_text_guard_retried'
    );
    const eventPayload = eventCall!.args[0] as { metadata: { outcome: string } };
    expect(eventPayload.metadata.outcome).toBe('fallback_token');
  });
});

// Follow-up (2026-07-28): extends the SAME token condition to reviewPrompt's
// own single-brace illustrative examples ("{name}", "{month}", "{need}",
// "{freesOn}") — this model has previously been observed echoing prompt
// example text verbatim (the Build 4 Part B "Good tone" month-name fix), so
// this is a real, not merely theoretical, risk. Enumerated names only —
// never a generic single-brace scan, which would false-positive on ordinary
// prose or a user-defined category name.
describe('POST /api/regenerate-plan — reviewText illustrative single-brace token leak', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  const noCardFixture = {
    users: [{ data: { household_id: 'hh1' }, error: null }],
    households: [
      // FIRST read is the Pro gate (requirePro runs before
      // getHouseholdTimezone). These suites test plan generation, not
      // entitlement, so they run as a paying household.
      { data: { subscription_status: 'active', subscription_current_period_end: '2099-01-01T00:00:00Z', comp_until: null }, error: null },
      { data: { timezone: 'America/Toronto' }, error: null },
    ],
    transactions: [{ data: [], error: null }, { data: [], error: null }],
    accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
    sinking_funds: [{ data: [], error: null }],
    recurring_items: [{ data: [], error: null }, { data: [], error: null }],
    conversations: [{ error: null }],
  };

  it.each(['name', 'month', 'need', 'freesOn'])('retries once when reviewText echoes the illustrative "{%s}" token verbatim', async (token) => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: `Your plan sets aside $300/month for {${token}}, so plan around it.` }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine, clean month overall.' }] });

    const { client, calls } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('A fine, clean month overall.');

    const eventCall = calls.find(
      (c) => c.table === 'events' && c.method === 'insert' &&
             (c.args[0] as { event_type?: string })?.event_type === 'review_text_guard_retried'
    );
    const eventPayload = eventCall!.args[0] as { metadata: { triggeredBy: string[] } };
    expect(eventPayload.metadata.triggeredBy).toEqual(['token_leak']);
  });

  it('control: a legitimate brace in prose or a user-defined category name never triggers a retry', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Your Fun {Money} category ran $50 over this month, worth a look.' }] });

    const { client } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(2); // no retry
    expect(json.reviewText).toBe('Your Fun {Money} category ran $50 over this month, worth a look.');
  });

  it('combined: an illustrative token leak AND a borrowed-cash issue on the same retry — borrowed-cash priority still holds', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Your plan sets aside $300/month for {name}.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Your plan sets aside $300/month for {name}, and your $1,000 draw gives you $1,000 of surplus.' }] });

    const drawFixture = {
      ...noCardFixture,
      transactions: [
        {
          data: [
            { amount: 2000, type: 'income', description: 'Salary', account_id: 'chq-1' },
            { amount: 1800, type: 'expense', description: 'Rent', account_id: 'chq-1' },
            { amount: -1000, type: 'transfer', description: 'Line of credit draw', account_id: 'chq-1', transfer_peer_id: 'peer-1', id: 'tx-1' },
          ],
          error: null,
        },
        { data: [], error: null },
      ],
    };

    const { client, calls } = makeSupabaseMock(drawFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'en' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3); // never a 3rd retry
    expect(json.reviewText).toContain('borrowed');
    expect(json.reviewText).not.toContain('{name}');

    const eventCall = calls.find(
      (c) => c.table === 'events' && c.method === 'insert' &&
             (c.args[0] as { event_type?: string })?.event_type === 'review_text_guard_retried'
    );
    const eventPayload = eventCall!.args[0] as { metadata: { outcome: string; triggeredBy: string[] } };
    expect(eventPayload.metadata.outcome).toBe('fallback_borrowed');
    expect(eventPayload.metadata.triggeredBy).toEqual(['token_leak']);
  });

  it('catches the leak in French too', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Continuez.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Votre plan met de côté 300$/mois pour {name}.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Un mois clair et simple.' }] });

    const { client } = makeSupabaseMock(noCardFixture);
    const { createClient } = await import('@/lib/supabase-server');
    (createClient as ReturnType<typeof vi.fn>).mockResolvedValue(client);

    const { POST } = await import('../route');
    const res = await POST(new Request('http://localhost/api/regenerate-plan', {
      method: 'POST',
      body: JSON.stringify({ locale: 'fr' }),
    }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(createMock).toHaveBeenCalledTimes(3);
    expect(json.reviewText).toBe('Un mois clair et simple.');
  });
});
