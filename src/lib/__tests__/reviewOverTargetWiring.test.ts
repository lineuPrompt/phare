import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// The monthly review takes its over-target category from the shared check
// (cardOverTarget.overTargetCategoriesForLiveCycles), which judges against the
// plan the Cards page shows — carried forward included. 2026-09-29.
//
// The check itself is tested in cardOverTarget.test.ts. This pins the wiring:
// the service calls it for the household's cards with the household's today,
// and the ONE category it selects from the result is what reaches the prompt.
// No AI is called (anthropic is mocked), so no generation is spent.
// ---------------------------------------------------------------------------

type Resolution = { data?: unknown; error?: unknown; count?: number };

function chain(resolution: Resolution): unknown {
  return new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: (v: Resolution) => unknown, reject?: (v: unknown) => unknown) =>
          Promise.resolve(resolution).then(resolve, reject);
      }
      if (prop === 'catch') return (r: (v: unknown) => unknown) => Promise.resolve(resolution).catch(r);
      return () => chain(resolution);
    },
  });
}

const CARD = { id: 'card-master', name: 'MASTER', type: 'credit_card', statement_close_day: 15 };

function makeClient() {
  const script: Record<string, Resolution[]> = {
    accounts: [{ data: [CARD], error: null }],
    households: [{ data: { timezone: 'America/Toronto' }, error: null }],
  };
  const cursors: Record<string, number> = {};
  const entry = (table: string) => {
    const idx = cursors[table] ?? 0;
    cursors[table] = idx + 1;
    return chain(script[table]?.[idx] ?? { data: [], error: null, count: 0 });
  };
  return { from: (table: string) => ({ select: () => entry(table), insert: () => entry(table), update: () => entry(table) }) };
}

const createMock = vi.fn();
vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...a: unknown[]) => createMock(...a) } },
}));

const overTargetMock = vi.fn();
vi.mock('@/lib/cardOverTarget', () => ({
  overTargetCategoriesForLiveCycles: (...a: unknown[]) => overTargetMock(...a),
}));

async function generate() {
  const { generateMonthlyReview } = await import('@/lib/monthlyReviewService');
  const client = makeClient();
  await generateMonthlyReview({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: client as any,
    householdId: 'hh-A',
    locale: 'en',
    timezone: 'America/Toronto',
    reviewMonth: '2026-09',
    userId: 'user-1',
  } as Parameters<typeof generateMonthlyReview>[0]);
  return client;
}

const allPrompts = () => JSON.stringify(createMock.mock.calls.map((c) => c[0]));

describe('generateMonthlyReview — over-target category comes from the shared check', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T12:00:00-04:00'));
    createMock.mockReset();
    overTargetMock.mockReset();
    createMock
      .mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ lineClassifications: [], topRecommendation: 'Keep going.' }) }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'September was steady.' }] });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('calls the check for the household\'s cards, on the household\'s today', async () => {
    overTargetMock.mockResolvedValue([]);
    const client = await generate();
    expect(overTargetMock).toHaveBeenCalledTimes(1);
    const [supabase, householdId, cards, , today] = overTargetMock.mock.calls[0];
    expect(supabase).toBe(client);
    expect(householdId).toBe('hh-A');
    expect(cards).toEqual([CARD]);
    expect(today).toBe('2026-09-29');
  });

  it('the largest overspend it reports becomes the review\'s source category', async () => {
    overTargetMock.mockResolvedValue([
      { categoryName: 'Restaurants', target: 150, actual: 170, over: 20 },
      { categoryName: 'Groceries & Pharmacy', target: 500, actual: 620, over: 120 },
    ]);
    await generate();
    const prompts = allPrompts();
    expect(prompts).toContain('\\"sourceCategory\\":{\\"categoryName\\":\\"Groceries & Pharmacy\\",\\"target\\":500,\\"actual\\":620,\\"over\\":120}');
  });

  it('nothing over target: the source category is null', async () => {
    overTargetMock.mockResolvedValue([]);
    await generate();
    expect(allPrompts()).toContain('\\"sourceCategory\\":null');
  });
});
