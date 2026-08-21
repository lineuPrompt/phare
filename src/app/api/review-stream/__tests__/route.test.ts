import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { REVIEW_MAX_BODY_BYTES } from '@/lib/promptInputLimits';

// ---------------------------------------------------------------------------
// Route-level contracts for /api/review-stream that the pure lib cannot cover:
// the malformed-JSON fix (finding M4), the 413 shape, and the proof that
// shrinking `analysis` to { source } changed nothing about the prompt.
// ---------------------------------------------------------------------------

const createMock = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...args: unknown[]) => createMock(...args) } },
}));

/** An empty async-iterable stream, which is all the route needs to succeed. */
function emptyStream() {
  return { async *[Symbol.asyncIterator]() {} };
}

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue(emptyStream());
  // Each test gets a fresh module instance so the module-scoped rate limiter
  // (8 per 5 minutes) never leaks a budget between tests.
  vi.resetModules();
});

async function post(rawBody: string) {
  const { POST } = await import('../route');
  return POST(
    new Request('http://localhost/api/review-stream', {
      method: 'POST',
      body: rawBody,
    }) as unknown as NextRequest
  );
}

/** The prompt string the route handed to Anthropic on the last call. */
function lastPrompt(): string {
  return createMock.mock.calls[0][0].messages[0].content as string;
}

const PLAN = {
  monthlyBudget: {
    totalIncome: 8000, totalExpenses: 6000, totalSavings: 2000,
    categories: [{ name: 'Groceries', budgeted: 800, type: 'expense', seedCategory: 'Groceries & Pharmacy', isFixed: false }],
  },
  seedCategories: ['Housing'],
  sinkingFunds: [{ name: 'Property tax', annualAmount: 4800, monthlyProvision: 400, dueMonth: 'March', fundedAlready: false }],
  debtPayoff: null,
  goals: [],
  topRecommendation: 'Move $450/month into the reserve fund.',
};

describe('malformed JSON (finding M4)', () => {
  // `await request.json()` used to sit outside any try block, so a malformed
  // body became an unhandled rejection instead of a response the client could
  // read. The assertion that matters is that this RESOLVES at all.
  it('returns 400 with a code rather than rejecting', async () => {
    const res = await post('{ this is not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'INVALID_JSON',
      error: 'Request body was not valid JSON.',
    });
  });

  it('does not call Anthropic on a malformed body', async () => {
    await post('{{{');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('returns 400 for an empty body', async () => {
    expect((await post('')).status).toBe(400);
  });
});

describe('body size cap', () => {
  it('rejects an oversized body with 413 and a machine-readable code', async () => {
    const res = await post('x'.repeat(REVIEW_MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.field).toBe('body');
    expect(body.limit).toBe(REVIEW_MAX_BODY_BYTES);
    expect(body.actual).toBe(REVIEW_MAX_BODY_BYTES + 1);
  });

  it('never reaches Anthropic when the body is oversized', async () => {
    await post('x'.repeat(REVIEW_MAX_BODY_BYTES + 1));
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized plan field inside an acceptable body', async () => {
    // Body is under the cap, but one field blows an array limit.
    const res = await post(JSON.stringify({
      plan: { ...PLAN, goals: Array.from({ length: 101 }, (_, i) => ({ name: `g${i}` })) },
      analysis: { source: 'template' },
      locale: 'en',
    }));
    expect(res.status).toBe(413);
    expect((await res.json()).field).toBe('plan.goals');
  });
});

describe('step A — shrinking `analysis` changed nothing about the prompt', () => {
  it('produces a byte-identical prompt for { source } and the full legacy payload', async () => {
    // What the client used to send: the entire /api/plan request body.
    const legacyAnalysis = {
      source: 'template',
      locale: 'en',
      parsed: {
        household: { Province: 'Quebec' },
        summary: { monthlyIncome: 8000, monthlyExpenses: 6000, netCashFlow: 2000 },
        income: { lines: [{ label: 'Salary', amount: 8000 }], total: 8000 },
        fixedExpenses: { lines: [], total: 0 },
        variableExpenses: { lines: [], total: 0 },
        sinkingFunds: { lines: [], annualTotal: 0, monthlyTotal: 0 },
        goals: [],
      },
    };

    await post(JSON.stringify({ plan: PLAN, analysis: legacyAnalysis, locale: 'en' }));
    const withLegacy = lastPrompt();

    createMock.mockClear();
    vi.resetModules();

    await post(JSON.stringify({ plan: PLAN, analysis: { source: 'template' }, locale: 'en' }));
    const withSlim = lastPrompt();

    expect(withSlim).toBe(withLegacy);
  });

  it('still distinguishes the manual (calculated) source, which is all `analysis` was ever for', async () => {
    await post(JSON.stringify({ plan: PLAN, analysis: { source: 'calculated' }, locale: 'en' }));
    expect(lastPrompt()).toContain('entered ONLY their income and expenses');

    createMock.mockClear();
    vi.resetModules();

    await post(JSON.stringify({ plan: PLAN, analysis: { source: 'template' }, locale: 'en' }));
    expect(lastPrompt()).not.toContain('entered ONLY their income and expenses');
  });

  it('no longer emits the dead "Key context" block', async () => {
    await post(JSON.stringify({ plan: PLAN, analysis: { source: 'template' }, locale: 'en' }));
    const prompt = lastPrompt();
    // `analysis.insights` never existed anywhere in the repo, so this block
    // always rendered as the header followed by a bare `[]` on its own line.
    // Asserting on a bare `[]` anywhere would be wrong — an empty goals array
    // serialises to "goals":[] inside the plan and is entirely legitimate.
    expect(prompt).not.toContain('Key context');
    expect(prompt.split('\n')).not.toContain('[]');
  });
});

describe('prompt payload is the projection, not the raw body', () => {
  it('omits a smuggled field from the plan object', async () => {
    await post(JSON.stringify({
      plan: { ...PLAN, smuggled: 'q'.repeat(4000) },
      analysis: { source: 'template' },
      locale: 'en',
    }));
    const prompt = lastPrompt();
    expect(prompt).not.toContain('smuggled');
    expect(prompt).not.toContain('qqqq');
  });

  it('keeps the fields the review prompt narrates', async () => {
    await post(JSON.stringify({ plan: PLAN, analysis: { source: 'template' }, locale: 'en' }));
    const prompt = lastPrompt();
    expect(prompt).toContain('"fundedAlready":false');
    expect(prompt).toContain('Property tax');
    expect(prompt).toContain('Move $450/month into the reserve fund.');
  });
});

describe('upstream failure', () => {
  it('reports AI_UNAVAILABLE rather than a bare English 500', async () => {
    createMock.mockRejectedValue(new Error('credit balance too low'));
    const res = await post(JSON.stringify({ plan: PLAN, analysis: { source: 'template' }, locale: 'en' }));
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('AI_UNAVAILABLE');
  });
});
