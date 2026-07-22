import { describe, it, expect, vi, beforeEach } from 'vitest';

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
      throw new Error(`No scripted response for table "${table}" call #${idx + 1} (method: ${method})`);
    }
    return makeResultChain(list[idx]);
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => ({
      select: (...args: unknown[]) => entry(table, 'select', args),
      insert: (...args: unknown[]) => entry(table, 'insert', args),
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [
        { data: [{ amount: 5000, type: 'income', description: 'Salary', account_id: 'chq-1' }], error: null },
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [
        // Month-scoped fetch (headline figures)
        { data: [{ amount: 5000, type: 'income', description: 'Salary', account_id: 'chq-1' }], error: null },
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [{ data: [], error: null }],
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [
        { data: [], error: null }, // month-scoped headline figures
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [
        { data: [], error: null }, // month-scoped headline figures
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [{ data: [], error: null }],
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [
        {
          data: [
            { amount: 2749, type: 'income', description: "Lineu's paycheque", account_id: 'chq-1', recurring_item_id: 'ri-1' },
            { amount: 2749, type: 'income', description: "Lineu's paycheque", account_id: 'chq-1', recurring_item_id: 'ri-1' },
            { amount: 2749, type: 'income', description: "Lineu's paycheque", account_id: 'chq-1', recurring_item_id: 'ri-1' },
          ],
          error: null,
        },
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [{ data: [], error: null }],
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
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [{ data: [], error: null }],
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
    expect(reviewPromptSent).toContain('SINKING FUNDS');
    expect(reviewPromptSent).toContain('ZERO-BALANCE GOALS');
  });

  it('sinking fund review truth: every fund sharing a linked account with a real positive balance flows as ONE sinkingFundBuffer.fundedAlready:true', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      households: [{ data: { timezone: 'America/Toronto' }, error: null }],
      transactions: [
        { data: [], error: null }, // month-scoped headline figures
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
