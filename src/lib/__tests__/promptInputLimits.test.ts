import { describe, it, expect } from 'vitest';
import {
  PLAN_MAX_BODY_BYTES,
  REVIEW_MAX_BODY_BYTES,
  MAX_INCOME_LINES,
  MAX_FIXED_EXPENSE_LINES,
  MAX_VARIABLE_EXPENSE_LINES,
  MAX_SINKING_FUND_LINES,
  MAX_GOALS,
  MAX_HOUSEHOLD_KEYS,
  MAX_BUDGET_CATEGORIES,
  MAX_LABEL_CHARS,
  MAX_HOUSEHOLD_KEY_CHARS,
  MAX_HOUSEHOLD_VALUE_CHARS,
  PAYLOAD_TOO_LARGE,
  PromptInputTooLargeError,
  isPromptInputTooLargeError,
  assertBodySize,
  assertArrayLength,
  assertStringLength,
  assertHouseholdShape,
  projectTemplateForPrompt,
  projectCalculatedForPrompt,
  projectPlanForReviewPrompt,
} from '../promptInputLimits';

// ---------------------------------------------------------------------------
// These guards close finding C1: /api/plan and /api/review-stream interpolated
// request-body fields into an Anthropic prompt with no length validation, so
// an unauthenticated caller chose the prompt's size (~1M tokens, ~$3.00/call).
//
// The contract these tests pin is REJECT, NEVER TRUNCATE. A truncated prompt
// produces a confident plan built on a ledger the family never entered — the
// silent-wrong-number failure this codebase refuses. Every assertion below
// that checks a boundary also checks that the value AT the limit still passes,
// because the other way to break this is a cap so tight it refuses real
// onboarding.
// ---------------------------------------------------------------------------

const rep = (n: number, ch = 'x') => ch.repeat(n);

/** Every JSON object key appearing anywhere in a serialised value. */
function keysIn(value: unknown): Set<string> {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') {
      for (const [k, child] of Object.entries(v)) {
        found.add(k);
        walk(child);
      }
    }
  };
  walk(value);
  return found;
}

// A template payload that exercises every projected field at once.
function templateFixture() {
  return {
    // Fields the prompt reads
    household: { 'Province': 'Quebec', 'Number of adults': '2' },
    summary: { monthlyIncome: 8000, monthlyExpenses: 6000, netCashFlow: 2000 },
    income: {
      lines: [{ label: 'Salary', amount: 5000, rawAmount: 2500, frequency: 'biweekly', member: 'Alex' }],
    },
    fixedExpenses: {
      lines: [{ label: 'Mortgage', amount: 2400, rawAmount: 1200, frequency: 'biweekly' }],
    },
    variableExpenses: { lines: [{ label: 'Groceries', amount: 800 }] },
    sinkingFunds: {
      lines: [{ label: 'Property tax', annualAmount: 4800, monthlyProvision: 400, dueMonth: 'March' }],
    },
    goals: [{ name: 'Emergency fund', targetAmount: 15000, savedSoFar: 1000, targetDate: '2027-03-01' }],
    // Fields the route receives but never reads — must not survive projection
    isTemplate: true,
    isValidV3: true,
    incomeSkippedRows: 3,
    fixedExpenseSkippedRows: 1,
    goalDateFlaggedRows: 2,
  };
}

describe('the error type', () => {
  it('carries code, field, limit and actual', () => {
    const e = new PromptInputTooLargeError('parsed.goals', 100, 101, 'too many');
    expect(e.code).toBe(PAYLOAD_TOO_LARGE);
    expect(e.field).toBe('parsed.goals');
    expect(e.limit).toBe(100);
    expect(e.actual).toBe(101);
  });

  // The routes branch on instanceof to decide 413-vs-500. Under a downlevel
  // emit a subclass of Error can lose its prototype chain and quietly fall
  // through to the 500 path, so this is load-bearing, not a formality.
  it('survives instanceof after construction', () => {
    const e = new PromptInputTooLargeError('body', 1, 2, 'x');
    expect(e).toBeInstanceOf(PromptInputTooLargeError);
    expect(e).toBeInstanceOf(Error);
    expect(isPromptInputTooLargeError(e)).toBe(true);
    expect(isPromptInputTooLargeError(new Error('plain'))).toBe(false);
  });
});

describe('assertBodySize', () => {
  it('accepts a body exactly at the limit', () => {
    expect(() => assertBodySize(rep(PLAN_MAX_BODY_BYTES), PLAN_MAX_BODY_BYTES)).not.toThrow();
  });

  it('rejects one byte over the limit', () => {
    expect(() => assertBodySize(rep(PLAN_MAX_BODY_BYTES + 1), PLAN_MAX_BODY_BYTES))
      .toThrow(PromptInputTooLargeError);
  });

  it('measures BYTES, not characters — a multi-byte body at the char limit is refused', () => {
    // 'é' is 2 bytes in UTF-8. A string of limit/2 + 1 of them is under the
    // character count but over the byte cap; counting .length here would let
    // an accented French payload through at double the intended size.
    const accented = 'é'.repeat(PLAN_MAX_BODY_BYTES / 2 + 1);
    expect(accented.length).toBeLessThan(PLAN_MAX_BODY_BYTES);
    expect(() => assertBodySize(accented, PLAN_MAX_BODY_BYTES)).toThrow(PromptInputTooLargeError);
  });

  it('reports the offending field and both numbers', () => {
    try {
      assertBodySize(rep(PLAN_MAX_BODY_BYTES + 5), PLAN_MAX_BODY_BYTES, 'body');
      throw new Error('should have thrown');
    } catch (e) {
      expect(isPromptInputTooLargeError(e)).toBe(true);
      const err = e as PromptInputTooLargeError;
      expect(err.field).toBe('body');
      expect(err.limit).toBe(PLAN_MAX_BODY_BYTES);
      expect(err.actual).toBe(PLAN_MAX_BODY_BYTES + 5);
    }
  });

  it('uses a review cap larger than the plan cap', () => {
    // The review body legitimately carries the assembled plan, so its ceiling
    // is higher. If these ever invert, review-stream silently becomes the
    // tighter path and real onboarding breaks there first.
    expect(REVIEW_MAX_BODY_BYTES).toBeGreaterThan(PLAN_MAX_BODY_BYTES);
  });
});

describe('assertArrayLength / assertStringLength boundaries', () => {
  it('accepts exactly at the limit and rejects one over', () => {
    expect(() => assertArrayLength(new Array(10).fill(0), 'f', 10)).not.toThrow();
    expect(() => assertArrayLength(new Array(11).fill(0), 'f', 10)).toThrow(PromptInputTooLargeError);
    expect(() => assertStringLength(rep(10), 'f', 10)).not.toThrow();
    expect(() => assertStringLength(rep(11), 'f', 10)).toThrow(PromptInputTooLargeError);
  });
});

describe('assertHouseholdShape', () => {
  const hh = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 'v']));

  it('accepts exactly MAX_HOUSEHOLD_KEYS fields', () => {
    expect(() => assertHouseholdShape(hh(MAX_HOUSEHOLD_KEYS))).not.toThrow();
  });

  it('rejects one field over', () => {
    expect(() => assertHouseholdShape(hh(MAX_HOUSEHOLD_KEYS + 1))).toThrow(PromptInputTooLargeError);
  });

  it('accepts a value exactly at MAX_HOUSEHOLD_VALUE_CHARS', () => {
    expect(() => assertHouseholdShape({ note: rep(MAX_HOUSEHOLD_VALUE_CHARS) })).not.toThrow();
  });

  it('rejects a value one character over', () => {
    expect(() => assertHouseholdShape({ note: rep(MAX_HOUSEHOLD_VALUE_CHARS + 1) }))
      .toThrow(PromptInputTooLargeError);
  });

  it('accepts a key exactly at MAX_HOUSEHOLD_KEY_CHARS and rejects one over', () => {
    expect(() => assertHouseholdShape({ [rep(MAX_HOUSEHOLD_KEY_CHARS)]: 'v' })).not.toThrow();
    expect(() => assertHouseholdShape({ [rep(MAX_HOUSEHOLD_KEY_CHARS + 1)]: 'v' }))
      .toThrow(PromptInputTooLargeError);
  });

  // Phase 1 decision (c): shape allowlist, NOT a key allowlist. A household
  // that renamed a field in Excel — or a future template revision — must keep
  // its answer. This test fails under any key-allowlist implementation.
  it('PRESERVES an unrecognised key rather than dropping it', () => {
    const out = assertHouseholdShape({
      'Province': 'Quebec',
      'Notre propre champ maison': 'une réponse',
    });
    expect(out).toEqual({
      'Province': 'Quebec',
      'Notre propre champ maison': 'une réponse',
    });
  });

  it('rejects a non-string value, which is how a nested blob would be smuggled in', () => {
    expect(() => assertHouseholdShape({ nested: { a: 'b' } as unknown as string })).toThrow(TypeError);
  });

  it('treats a missing household as empty rather than failing', () => {
    expect(assertHouseholdShape(undefined)).toEqual({});
    expect(assertHouseholdShape(null)).toEqual({});
  });
});

describe('projectTemplateForPrompt — array caps', () => {
  const lines = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `l${i}`, amount: 1 }));
  const base = templateFixture();

  const cases: [string, number, (n: number) => object][] = [
    ['parsed.income.lines', MAX_INCOME_LINES, (n) => ({ ...base, income: { lines: lines(n) } })],
    ['parsed.fixedExpenses.lines', MAX_FIXED_EXPENSE_LINES, (n) => ({ ...base, fixedExpenses: { lines: lines(n) } })],
    ['parsed.variableExpenses.lines', MAX_VARIABLE_EXPENSE_LINES, (n) => ({ ...base, variableExpenses: { lines: lines(n) } })],
    ['parsed.sinkingFunds.lines', MAX_SINKING_FUND_LINES, (n) => ({ ...base, sinkingFunds: { lines: lines(n) } })],
    ['parsed.goals', MAX_GOALS, (n) => ({ ...base, goals: Array.from({ length: n }, (_, i) => ({ name: `g${i}`, targetAmount: 1, savedSoFar: 0, targetDate: null })) })],
  ];

  for (const [field, limit, build] of cases) {
    it(`${field}: accepts exactly ${limit}`, () => {
      expect(() => projectTemplateForPrompt(build(limit))).not.toThrow();
    });
    it(`${field}: rejects ${limit + 1}`, () => {
      try {
        projectTemplateForPrompt(build(limit + 1));
        throw new Error('should have thrown');
      } catch (e) {
        expect(isPromptInputTooLargeError(e)).toBe(true);
        expect((e as PromptInputTooLargeError).field).toBe(field);
        expect((e as PromptInputTooLargeError).limit).toBe(limit);
      }
    });
  }

  it('accepts a label exactly at MAX_LABEL_CHARS and rejects one over', () => {
    const at = { ...base, variableExpenses: { lines: [{ label: rep(MAX_LABEL_CHARS), amount: 1 }] } };
    const over = { ...base, variableExpenses: { lines: [{ label: rep(MAX_LABEL_CHARS + 1), amount: 1 }] } };
    expect(() => projectTemplateForPrompt(at)).not.toThrow();
    expect(() => projectTemplateForPrompt(over)).toThrow(PromptInputTooLargeError);
  });
});

// ---------------------------------------------------------------------------
// THE REGRESSION THAT MATTERS. A projection that misses a field does not throw
// — it silently hands the model a thinner ledger and gets back a plausible,
// wrong plan. Each field asserted here is one the route or its prompt actually
// reads, verified against api/plan/route.ts and goalHelpers.ts.
// ---------------------------------------------------------------------------
describe('projectTemplateForPrompt — preserves every field the prompt reads', () => {
  const out = projectTemplateForPrompt(templateFixture());

  it('keeps household verbatim', () => {
    expect(out.household).toEqual({ 'Province': 'Quebec', 'Number of adults': '2' });
  });

  it('keeps all three summary figures (route.ts:98-99,131)', () => {
    expect(out.summary).toEqual({ monthlyIncome: 8000, monthlyExpenses: 6000, netCashFlow: 2000 });
  });

  it('keeps every income line field including member (route.ts:102-105)', () => {
    expect(out.income.lines[0]).toEqual({
      label: 'Salary', amount: 5000, rawAmount: 2500, frequency: 'biweekly', member: 'Alex',
    });
  });

  it('keeps every fixed expense line field (route.ts:106-109)', () => {
    expect(out.fixedExpenses.lines[0]).toEqual({
      label: 'Mortgage', amount: 2400, rawAmount: 1200, frequency: 'biweekly',
    });
  });

  it('keeps variable expense label and amount (route.ts:110-112)', () => {
    expect(out.variableExpenses.lines[0]).toEqual({ label: 'Groceries', amount: 800 });
  });

  it('keeps every sinking fund field (route.ts:120-128,135)', () => {
    expect(out.sinkingFunds.lines[0]).toEqual({
      label: 'Property tax', annualAmount: 4800, monthlyProvision: 400, dueMonth: 'March',
    });
  });

  it('keeps the four goal fields evaluateGoals/computeDebtPayoff require', () => {
    expect(out.goals[0]).toEqual({
      name: 'Emergency fund', targetAmount: 15000, savedSoFar: 1000, targetDate: '2027-03-01',
    });
  });

  it('drops fields the route never reads', () => {
    const keys = keysIn(out);
    for (const unread of ['isTemplate', 'isValidV3', 'incomeSkippedRows', 'fixedExpenseSkippedRows', 'goalDateFlaggedRows', 'total', 'annualTotal', 'monthlyTotal', 'targetDateFlagged']) {
      expect(keys.has(unread)).toBe(false);
    }
  });

  it('drops an attacker-supplied field that was never part of the shape', () => {
    const out2 = projectTemplateForPrompt({
      ...templateFixture(),
      evilPayload: rep(5000),
      income: { lines: [{ label: 'Salary', amount: 1, smuggled: rep(5000) }] },
    });
    const keys = keysIn(out2);
    expect(keys.has('evilPayload')).toBe(false);
    expect(keys.has('smuggled')).toBe(false);
    expect(JSON.stringify(out2)).not.toContain('xxxxx');
  });
});

// The prompt is built by JSON.stringify-ing these projections, so "no key
// outside the allowlist reaches the model" is checkable directly on the
// serialised string.
describe('the serialised prompt payload contains no key outside the allowlist', () => {
  const ALLOWED_TEMPLATE = new Set([
    'household', 'Province', 'Number of adults',
    'summary', 'monthlyIncome', 'monthlyExpenses', 'netCashFlow',
    'income', 'fixedExpenses', 'variableExpenses', 'sinkingFunds', 'lines',
    'label', 'amount', 'rawAmount', 'frequency', 'member',
    'annualAmount', 'monthlyProvision', 'dueMonth',
    'goals', 'name', 'targetAmount', 'savedSoFar', 'targetDate',
  ]);

  it('template projection', () => {
    const out = projectTemplateForPrompt({
      ...templateFixture(),
      surprise: 'nope',
      goals: [{ name: 'g', targetAmount: 1, savedSoFar: 0, targetDate: null, targetDateFlagged: true }],
    });
    for (const k of keysIn(JSON.parse(JSON.stringify(out)))) {
      expect(ALLOWED_TEMPLATE.has(k), `unexpected key in prompt payload: ${k}`).toBe(true);
    }
  });

  it('calculated projection', () => {
    const ALLOWED_CALC = new Set([
      'netCashFlow', 'income', 'expenses', 'total', 'lines',
      'label', 'amount', 'rawAmount', 'frequency',
    ]);
    const out = projectCalculatedForPrompt({
      netCashFlow: 2000,
      income: { detected: true, total: 5000, lines: [{ label: 'Salary', amount: 5000, sneaky: 1 }] },
      expenses: { detected: true, total: 3000, lines: [{ label: 'Rent', amount: 3000 }] },
      excludedLines: [], confidence: 'high',
    });
    for (const k of keysIn(JSON.parse(JSON.stringify(out)))) {
      expect(ALLOWED_CALC.has(k), `unexpected key in prompt payload: ${k}`).toBe(true);
    }
  });
});

describe('projectCalculatedForPrompt', () => {
  it('keeps the fields assembleCalculatedBudget and the prompt read', () => {
    const out = projectCalculatedForPrompt({
      netCashFlow: 2000,
      income: { total: 5000, lines: [{ label: 'Salary', amount: 5000, rawAmount: 2500, frequency: 'biweekly' }] },
      expenses: { total: 3000, lines: [{ label: 'Rent', amount: 3000 }] },
    });
    expect(out.netCashFlow).toBe(2000);
    expect(out.income.total).toBe(5000);
    expect(out.expenses.total).toBe(3000);
    expect(out.income.lines[0]).toEqual({ label: 'Salary', amount: 5000, rawAmount: 2500, frequency: 'biweekly' });
  });

  // The existing route test posts lines with neither rawAmount nor frequency.
  // JSON.stringify drops undefined, so the serialised prompt is byte-identical
  // to the pre-fix output for those payloads — that is what "no behaviour
  // change for legitimate input" means here.
  it('serialises a minimal line exactly as the unprojected object did', () => {
    const out = projectCalculatedForPrompt({
      netCashFlow: 2000,
      income: { total: 5000, lines: [{ label: 'Salary', amount: 5000 }] },
      expenses: { total: 3000, lines: [{ label: 'Mortgage', amount: 3000 }] },
    });
    expect(JSON.stringify(out.income.lines)).toBe('[{"label":"Salary","amount":5000}]');
    expect(JSON.stringify(out.expenses.lines)).toBe('[{"label":"Mortgage","amount":3000}]');
  });

  it('caps income and expense line counts', () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `l${i}`, amount: 1 }));
    const body = (ni: number, ne: number) => ({
      netCashFlow: 0, income: { total: 0, lines: mk(ni) }, expenses: { total: 0, lines: mk(ne) },
    });
    expect(() => projectCalculatedForPrompt(body(MAX_INCOME_LINES, 1))).not.toThrow();
    expect(() => projectCalculatedForPrompt(body(MAX_INCOME_LINES + 1, 1))).toThrow(PromptInputTooLargeError);
    expect(() => projectCalculatedForPrompt(body(1, MAX_FIXED_EXPENSE_LINES))).not.toThrow();
    expect(() => projectCalculatedForPrompt(body(1, MAX_FIXED_EXPENSE_LINES + 1))).toThrow(PromptInputTooLargeError);
  });
});

describe('projectPlanForReviewPrompt', () => {
  const planFixture = () => ({
    monthlyBudget: {
      totalIncome: 8000, totalExpenses: 6000, totalSavings: 2000,
      categories: [
        { name: 'Salary', budgeted: 5000, type: 'income', rawAmount: 2500, frequency: 'biweekly', member: 'Alex', seedCategory: 'Income', isFixed: true },
        { name: 'Groceries', budgeted: 800, type: 'expense', seedCategory: 'Groceries & Pharmacy', isFixed: false },
      ],
    },
    seedCategories: ['Housing', 'Transportation'],
    sinkingFunds: [{ name: 'Property tax', annualAmount: 4800, monthlyProvision: 400, dueMonth: 'March', fundedAlready: false }],
    debtPayoff: { description: 'Car loan', targetDate: '2027-06', monthlyPayment: 300 },
    goals: [{
      name: 'Emergency fund', targetAmount: 15000, savedSoFar: 0, hasTargetDate: true,
      targetDate: '2027-03-01', monthlyContribution: 500, onTrack: true,
      fundedAlready: false, pastDue: false, estimatedDate: '2027-03',
    }],
    topRecommendation: 'Move $450/month into the reserve fund.',
  });

  // The review prompt narrates fundedAlready, savedSoFar and onTrack by name
  // in its hard rules. Dropping any one would make the letter assert money has
  // moved when it has not — the exact failure those rules exist to prevent.
  it('preserves every GoalResult field the review prompt narrates', () => {
    const out = projectPlanForReviewPrompt(planFixture());
    expect(out.goals[0]).toEqual(planFixture().goals[0]);
  });

  it('preserves sinking fund fundedAlready and the debt payoff card', () => {
    const out = projectPlanForReviewPrompt(planFixture());
    expect(out.sinkingFunds[0].fundedAlready).toBe(false);
    expect(out.debtPayoff).toEqual({ description: 'Car loan', targetDate: '2027-06', monthlyPayment: 300 });
  });

  it('keeps a null debtPayoff null rather than inventing a card', () => {
    const out = projectPlanForReviewPrompt({ ...planFixture(), debtPayoff: null });
    expect(out.debtPayoff).toBeNull();
  });

  it('serialises a variable-expense category exactly as before (undefined keys dropped)', () => {
    const out = projectPlanForReviewPrompt(planFixture());
    expect(JSON.stringify(out.monthlyBudget.categories[1]))
      .toBe('{"name":"Groceries","budgeted":800,"type":"expense","seedCategory":"Groceries & Pharmacy","isFixed":false}');
  });

  it('caps categories, sinking funds and goals', () => {
    const cat = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `c${i}`, budgeted: 1, type: 'expense' }));
    const withCats = (n: number) => ({ ...planFixture(), monthlyBudget: { ...planFixture().monthlyBudget, categories: cat(n) } });
    expect(() => projectPlanForReviewPrompt(withCats(MAX_BUDGET_CATEGORIES))).not.toThrow();
    expect(() => projectPlanForReviewPrompt(withCats(MAX_BUDGET_CATEGORIES + 1))).toThrow(PromptInputTooLargeError);

    const withGoals = (n: number) => ({ ...planFixture(), goals: Array.from({ length: n }, (_, i) => ({ name: `g${i}` })) });
    expect(() => projectPlanForReviewPrompt(withGoals(MAX_GOALS))).not.toThrow();
    expect(() => projectPlanForReviewPrompt(withGoals(MAX_GOALS + 1))).toThrow(PromptInputTooLargeError);

    const withFunds = (n: number) => ({ ...planFixture(), sinkingFunds: Array.from({ length: n }, (_, i) => ({ name: `s${i}` })) });
    expect(() => projectPlanForReviewPrompt(withFunds(MAX_SINKING_FUND_LINES))).not.toThrow();
    expect(() => projectPlanForReviewPrompt(withFunds(MAX_SINKING_FUND_LINES + 1))).toThrow(PromptInputTooLargeError);
  });

  it('drops smuggled fields from the plan object', () => {
    const out = projectPlanForReviewPrompt({ ...planFixture(), smuggled: rep(5000) });
    expect(JSON.stringify(out)).not.toContain('xxxxx');
    expect(keysIn(out).has('smuggled')).toBe(false);
  });

  it('refuses an oversized topRecommendation instead of trimming it', () => {
    expect(() => projectPlanForReviewPrompt({ ...planFixture(), topRecommendation: rep(MAX_LABEL_CHARS + 1) }))
      .toThrow(PromptInputTooLargeError);
  });
});

// ---------------------------------------------------------------------------
// The exposure itself, end to end through the pure layer: an oversized
// household is what finding C1 actually described.
// ---------------------------------------------------------------------------
describe('finding C1 reproduction', () => {
  it('refuses a ~1MB household blob that previously reached the prompt verbatim', () => {
    const evil = { ...templateFixture(), household: { bomb: rep(1_000_000) } };
    expect(() => projectTemplateForPrompt(evil)).toThrow(PromptInputTooLargeError);
  });

  it('refuses a household with 10,000 fields', () => {
    const evil = {
      ...templateFixture(),
      household: Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`k${i}`, 'v'])),
    };
    expect(() => projectTemplateForPrompt(evil)).toThrow(PromptInputTooLargeError);
  });

  it('still accepts the largest household Phase 1 measured (case D)', () => {
    // 30 income / 200 fixed / 150 variable / 100 sinking / 50 goals, 80-char
    // labels, 60 household fields — already implausible, and it must pass.
    const line = (i: number) => ({ label: rep(80, 'é').slice(0, 80) + i, amount: 100 + i });
    expect(() => projectTemplateForPrompt({
      household: Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`Field ${i}`, rep(80)])),
      summary: { monthlyIncome: 1, monthlyExpenses: 1, netCashFlow: 0 },
      income: { lines: Array.from({ length: 30 }, (_, i) => line(i)) },
      fixedExpenses: { lines: Array.from({ length: 200 }, (_, i) => line(i)) },
      variableExpenses: { lines: Array.from({ length: 150 }, (_, i) => line(i)) },
      sinkingFunds: { lines: Array.from({ length: 100 }, (_, i) => ({ label: `f${i}`, annualAmount: 1, monthlyProvision: 1, dueMonth: 'March' })) },
      goals: Array.from({ length: 50 }, (_, i) => ({ name: `g${i}`, targetAmount: 1, savedSoFar: 0, targetDate: null })),
    })).not.toThrow();
  });
});
