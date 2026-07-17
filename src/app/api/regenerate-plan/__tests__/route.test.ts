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
      transactions: [
        { data: [{ amount: 5000, type: 'income', description: 'Salary', account_id: 'chq-1' }], error: null },
      ],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [
        { data: [{ name: 'Property tax', annual_amount: 3600, monthly_provision: 300, due_month: 'March' }], error: null },
      ],
      recurring_items: [{ data: [], error: null }],
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
      transactions: [
        // Month-scoped fetch (headline figures)
        { data: [{ amount: 5000, type: 'income', description: 'Salary', account_id: 'chq-1' }], error: null },
        // All-time fetch for goal-account balance
        { data: [{ amount: 2000, type: 'transfer', account_id: 'goal-1' }], error: null },
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
      recurring_items: [{ data: [], error: null }],
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
      transactions: [{ data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [{ data: [], error: null }],
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
      transactions: [
        { data: [], error: null }, // month-scoped headline figures
        // All-time fetch for the debt account's balance: opened at -5000, one $200 payment.
        { data: [
          { amount: -5000, type: 'transfer', account_id: 'debt-1' },
          { amount: 200, type: 'transfer', account_id: 'debt-1' },
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
      recurring_items: [{ data: [], error: null }],
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

  it('Phase 3: recurring contributions and debt payments are narrated as already-committed, not extra room', async () => {
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'A fine month overall.' }] });

    const { client } = makeSupabaseMock({
      users: [{ data: { household_id: 'hh1' }, error: null }],
      transactions: [{ data: [], error: null }],
      accounts: [{ data: [{ id: 'chq-1', name: 'Chequing', type: 'chequing', goal_target: null, goal_target_date: null }], error: null }],
      sinking_funds: [{ data: [], error: null }],
      recurring_items: [
        { data: [{ amount: 500, cadence: 'monthly', accounts: { name: 'RRSP — Retraite', type: 'rrsp' } }], error: null },
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
});
