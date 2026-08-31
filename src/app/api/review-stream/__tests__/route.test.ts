import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { REVIEW_MAX_BODY_BYTES } from '@/lib/promptInputLimits';

// These routes became authenticated and quota'd. This file's assertions are
// about prompt shape, caps and error codes — not the gate — so the caller is
// mocked as a signed-in household with room. The gate has its own tests.
vi.mock('@/lib/supabase-server', async () => {
  const { supabaseServerMock } = await import('@/lib/__tests__/helpers/onboardingSessionMock');
  return supabaseServerMock();
});


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

// ===========================================================================
// NON-STREAMING MODE (?stream=0)
//
// React Native's fetch does not populate response.body, so the mobile client
// cannot read the chunked default at all. The flag changes the RESPONSE SHAPE
// and nothing else — same prompt, same model, same caps, same error codes.
//
// The regression that actually matters is the negative one: the live web
// client sends no flag and must keep streaming. Those cases are asserted
// explicitly for absent, '1', 'false' and '' rather than left implied.
// ===========================================================================

/**
 * One generation, served in whichever shape the caller asked for.
 *
 * This is the whole point of the equality test below: `chunks` is the single
 * source of truth, so the streamed deltas and the completed message cannot
 * drift apart in the fixture and produce a false pass. The streaming shape
 * also yields events the route must IGNORE (message_start, a non-text delta,
 * content_block_stop) so that "the assembled text" means text_delta only.
 */
function mockGeneration(chunks: string[], blocks?: string[]) {
  createMock.mockImplementation((params: { stream?: boolean }) => {
    if (params.stream) {
      return Promise.resolve({
        async *[Symbol.asyncIterator]() {
          yield { type: 'message_start', message: { id: 'msg_1' } };
          yield { type: 'content_block_start', index: 0 };
          for (const text of chunks) {
            yield { type: 'content_block_delta', delta: { type: 'text_delta', text } };
          }
          yield { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{"x":1}' } };
          yield { type: 'content_block_stop', index: 0 };
          yield { type: 'message_stop' };
        },
      });
    }
    return Promise.resolve({
      content: (blocks ?? [chunks.join('')]).map((text) => ({ type: 'text', text })),
    });
  });
}

/** POST with an explicit query string. */
async function postWithQuery(query: string, rawBody: string) {
  const { POST } = await import('../route');
  return POST(
    new Request(`http://localhost/api/review-stream${query}`, {
      method: 'POST',
      body: rawBody,
    }) as unknown as NextRequest
  );
}

const GOOD_BODY = JSON.stringify({ plan: PLAN, analysis: { source: 'template' }, locale: 'en' });

/** The four fragments a real generation would arrive in over the wire. */
const CHUNKS = [
  'June was a solid month overall. ',
  'You stayed within budget in four of five categories, ',
  'and your reserve plan is realistic.\n\n',
  'One thing to do this month: move $450/month into the reserve fund.',
];
const FULL_TEXT = CHUNKS.join('');

describe('?stream=0 returns JSON, not a stream', () => {
  it('sets Content-Type: application/json', async () => {
    mockGeneration(CHUNKS);
    const res = await postWithQuery('?stream=0', GOOD_BODY);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    expect(res.headers.get('Content-Type')).not.toMatch(/text\/plain/);
  });

  it('returns a body of exactly { review }', async () => {
    mockGeneration(CHUNKS);
    const res = await postWithQuery('?stream=0', GOOD_BODY);
    const body = await res.json();
    // toEqual, not toMatchObject: the shape is the contract mobile codes
    // against, so an extra field is a failure, not a bonus.
    expect(body).toEqual({ review: FULL_TEXT });
    expect(Object.keys(body)).toEqual(['review']);
  });

  it('asks Anthropic for a completed message, not a stream', async () => {
    mockGeneration(CHUNKS);
    await postWithQuery('?stream=0', GOOD_BODY);
    expect(createMock.mock.calls[0][0].stream).toBe(false);
  });

  it('sends the identical prompt and model that the streaming path sends', async () => {
    mockGeneration(CHUNKS);
    await postWithQuery('?stream=0', GOOD_BODY);
    const nonStreamingCall = createMock.mock.calls[0][0];

    createMock.mockClear();
    vi.resetModules();
    mockGeneration(CHUNKS);
    await postWithQuery('', GOOD_BODY);
    const streamingCall = createMock.mock.calls[0][0];

    expect(nonStreamingCall.messages[0].content).toBe(streamingCall.messages[0].content);
    expect(nonStreamingCall.model).toBe(streamingCall.model);
    expect(nonStreamingCall.max_tokens).toBe(streamingCall.max_tokens);
  });
});

describe('every other flag value still streams (the live-web-client regression)', () => {
  // A mistake here breaks onboarding for every web user, so each value the
  // route could plausibly be tempted to treat as an alias is named.
  const streamingCases: Array<[string, string]> = [
    ['absent', ''],
    ['?stream=1', '?stream=1'],
    ['?stream=false', '?stream=false'],
    ['?stream= (empty)', '?stream='],
    ['?stream=no', '?stream=no'],
    ['?stream=00', '?stream=00'],
    ['an unrelated param', '?foo=0'],
  ];

  for (const [label, query] of streamingCases) {
    it(`${label} streams text/plain`, async () => {
      mockGeneration(CHUNKS);
      const res = await postWithQuery(query, GOOD_BODY);
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(createMock.mock.calls[0][0].stream).toBe(true);
      expect(await res.text()).toBe(FULL_TEXT);
    });
  }
});

describe('the two modes produce the same review text', () => {
  it('is byte-identical for the same generation — proven by running both', async () => {
    // Both halves are driven by the SAME `CHUNKS` fixture through
    // mockGeneration, so this compares the route's two assembly paths rather
    // than two hand-written strings that happen to match.
    mockGeneration(CHUNKS);
    const streamed = await (await postWithQuery('', GOOD_BODY)).text();

    createMock.mockClear();
    vi.resetModules();
    mockGeneration(CHUNKS);
    const assembled = (await (await postWithQuery('?stream=0', GOOD_BODY)).json()).review;

    expect(assembled).toBe(streamed);
    expect(assembled).toBe(FULL_TEXT);
  });

  it('joins EVERY text block, not just the first', async () => {
    // The stream concatenates text_deltas across all content blocks, so
    // reading content[0].text alone would hand mobile a truncated letter.
    // Same four fragments, delivered as four blocks instead of one.
    mockGeneration(CHUNKS, CHUNKS);
    const res = await postWithQuery('?stream=0', GOOD_BODY);
    expect((await res.json()).review).toBe(FULL_TEXT);
  });

  it('drops non-text content blocks, exactly as the stream drops non-text deltas', async () => {
    createMock.mockResolvedValue({
      content: [
        { type: 'text', text: 'Real letter text.' },
        { type: 'tool_use', id: 'tu_1', name: 'x', input: {} },
      ],
    });
    const res = await postWithQuery('?stream=0', GOOD_BODY);
    expect((await res.json()).review).toBe('Real letter text.');
  });
});

describe('guards and caps are identical on both paths', () => {
  it('rejects an oversized body with 413 on ?stream=0', async () => {
    const res = await postWithQuery('?stream=0', 'x'.repeat(REVIEW_MAX_BODY_BYTES + 1));
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.field).toBe('body');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('rejects an oversized plan array with 413 on ?stream=0', async () => {
    const res = await postWithQuery('?stream=0', JSON.stringify({
      plan: { ...PLAN, goals: Array.from({ length: 101 }, (_, i) => ({ name: `g${i}` })) },
      analysis: { source: 'template' },
      locale: 'en',
    }));
    expect(res.status).toBe(413);
    expect((await res.json()).field).toBe('plan.goals');
  });

  it('returns 400 INVALID_JSON on ?stream=0, the same shape as the streaming path', async () => {
    const res = await postWithQuery('?stream=0', '{ this is not json');
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      code: 'INVALID_JSON',
      error: 'Request body was not valid JSON.',
    });
    expect(createMock).not.toHaveBeenCalled();
  });

  it('returns 503 AI_UNAVAILABLE on ?stream=0 when Anthropic fails', async () => {
    createMock.mockRejectedValue(new Error('credit balance too low'));
    const res = await postWithQuery('?stream=0', GOOD_BODY);
    expect(res.status).toBe(503);
    expect(res.headers.get('Content-Type')).toMatch(/application\/json/);
    expect((await res.json()).code).toBe('AI_UNAVAILABLE');
  });

  it('still applies the allowlist projection on ?stream=0', async () => {
    mockGeneration(CHUNKS);
    await postWithQuery('?stream=0', JSON.stringify({
      plan: { ...PLAN, smuggled: 'q'.repeat(4000) },
      analysis: { source: 'template' },
      locale: 'en',
    }));
    expect(lastPrompt()).not.toContain('smuggled');
  });
});
