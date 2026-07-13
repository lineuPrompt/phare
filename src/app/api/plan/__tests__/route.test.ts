import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// The AI must never instantiate structured objects (sinking-fund rows, goal
// cards, debt-payoff cards) for the manual-form (calculated) source. These
// tests drive a DELIBERATELY MISBEHAVING AI — one that returns sinking funds,
// goals, and a debtPayoff anyway — and prove the route strips every one of
// them from the calculated-source plan. That's the real contract: the plan's
// structured sections come from user input or code, never the model, even if
// the model volunteers them.

const createMock = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  anthropic: { messages: { create: (...args: unknown[]) => createMock(...args) } },
}));

function aiReturns(json: unknown) {
  createMock.mockResolvedValue({ content: [{ type: 'text', text: JSON.stringify(json) }] });
}

// A rogue payload: the model hands back sinking funds, goals, and a debt card
// none of which the family entered.
const ROGUE_AI = {
  lineClassifications: [
    { label: 'Salary', category: 'Income', isFixed: true },
    { label: 'Mortgage', category: 'Housing', isFixed: true },
  ],
  sinkingFunds: [
    { name: 'Property tax', annualAmount: 4800, monthlyProvision: 400, dueMonth: 'March' },
    { name: 'Car registration', annualAmount: 600, monthlyProvision: 50, dueMonth: 'June' },
  ],
  goals: [
    { name: 'Emergency fund', targetAmount: 15000, monthlyContribution: 500, onTrack: true, estimatedDate: '2028-01' },
  ],
  debtPayoff: { description: 'Pay off the car loan', targetDate: '2027-06', monthlyPayment: 300 },
  topRecommendation: 'Consider a property-tax fund — Quebec bills land in March and June.',
};

// The two-line manual input from the bug report: salary + a bi-weekly mortgage.
const CALCULATED_BODY = {
  source: 'calculated',
  locale: 'en',
  calculated: {
    netCashFlow: 2000,
    income: { total: 5000, lines: [{ label: 'Salary', amount: 5000 }] },
    expenses: { total: 3000, lines: [{ label: 'Mortgage', amount: 3000 }] },
  },
};

async function postPlan(body: unknown) {
  const { POST } = await import('../route');
  const res = await POST(new Request('http://localhost/api/plan', {
    method: 'POST',
    body: JSON.stringify(body),
  }) as unknown as NextRequest);
  return (await res.json()).plan;
}

describe('POST /api/plan — the AI may never instantiate structured objects (calculated source)', () => {
  beforeEach(() => {
    vi.resetModules();
    createMock.mockReset();
  });

  it('two-line manual input yields a plan with ZERO sinking funds and ZERO goals, even when the AI returns both', async () => {
    aiReturns(ROGUE_AI);
    const plan = await postPlan(CALCULATED_BODY);

    expect(plan.sinkingFunds).toEqual([]);
    expect(plan.goals).toEqual([]);
  });

  it('strips the AI-fabricated debtPayoff card for the calculated source', async () => {
    aiReturns(ROGUE_AI);
    const plan = await postPlan(CALCULATED_BODY);

    expect(plan.debtPayoff).toBeNull();
  });

  it('still keeps the user-derived budget categories and the AI prose recommendation', async () => {
    aiReturns(ROGUE_AI);
    const plan = await postPlan(CALCULATED_BODY);

    // The income/expense lines the user actually entered survive as categories...
    const names = plan.monthlyBudget.categories.map((c: { name: string }) => c.name);
    expect(names).toContain('Salary');
    expect(names).toContain('Mortgage');
    // ...and prose (a suggestion) is fine — it's the structured rows that aren't.
    expect(plan.topRecommendation).toBe(ROGUE_AI.topRecommendation);
  });

  it('does not send the AI a sinkingFunds or goals field to fill in (prompt cannot invite fabrication)', async () => {
    aiReturns(ROGUE_AI);
    await postPlan(CALCULATED_BODY);

    const prompt = createMock.mock.calls[0][0].messages[0].content as string;
    // The requested JSON schema must not contain goal/sinking-fund shapes.
    expect(prompt).not.toContain('"sinkingFunds"');
    expect(prompt).not.toContain('"goals"');
    expect(prompt).not.toContain('monthlyContribution');
    // Nor a debtPayoff card for this source.
    expect(prompt).not.toContain('"debtPayoff"');
  });
});
