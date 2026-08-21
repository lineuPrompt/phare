import type { IncomeFrequency } from './incomeHelpers';

// ---------------------------------------------------------------------------
// Input caps and allowlist projections for the two unauthenticated routes that
// spend Anthropic tokens: /api/plan and /api/review-stream.
//
// THE EXPOSURE THIS CLOSES. Both routes interpolated request-body fields into
// a prompt with `JSON.stringify` and no length validation — `p.household` at
// api/plan/route.ts:130 was echoed wholesale, and `plan` at
// api/review-stream/route.ts:41 likewise. A caller could therefore choose the
// prompt's size, and the practical ceiling was the platform request-body limit
// (~4.5MB), which is roughly the model's whole 1M-token context. At Sonnet
// 4.6's $3/1M input that is ~$3.00 of billable input per unauthenticated call,
// against ~$0.014 for a real large household.
//
// REJECT, NEVER TRUNCATE. Every guard here throws. Silently dropping a line
// item would hand the model an incomplete ledger and get back a confident,
// plausible plan built on numbers the family never entered — the exact
// silent-wrong-number failure this codebase refuses everywhere else. A refusal
// the user can read and act on is always better than a plan that is quietly
// wrong.
//
// WHY THE NUMBERS ARE WHAT THEY ARE. Every constant below is derived from
// measurement, not intuition: the real templateParser was run against the
// shipped public/phare_template.xlsx and against synthesised households of
// increasing size, and the resulting request bodies were serialised and
// weighed. Two reference points recur in the comments:
//
//   case B — the shipped template's own row capacity, every row filled
//            (4 income / 21 fixed / 13 variable / 10 sinking / 7 goals)
//   case C — a large household that added rows in Excel, 60-char labels
//            (12 income / 60 fixed / 40 variable / 30 sinking / 20 goals)
//   case D — a deliberately implausible power user, 80-char labels
//            (30 income / 200 fixed / 150 variable / 100 sinking / 50 goals)
//
// Case C is treated as the realistic ceiling and case D as the paranoid one.
// Limits clear case D everywhere, so no plausible household can trip them.
// ---------------------------------------------------------------------------

// ── Body-size caps ─────────────────────────────────────────────────────────
//
// Measured /api/plan bodies: case B 7,765 B, case C 23,917 B, case D 71,684 B.
// Rule: 5x case C, rounded up to the next power of two.
//   23,917 x 5 = 119,585 -> 131,072. That is 5.48x case C and 1.83x case D.
export const PLAN_MAX_BODY_BYTES = 131_072; // 128 KB

// Measured /api/review-stream bodies AFTER the redundant `analysis` payload
// was reduced to `{ source }` (it previously carried a second copy of the
// entire /api/plan body, of which the prompt read exactly one field):
// case B 9,233 B, case C 29,018 B, case D 93,137 B.
// Same rule: 29,018 x 5 = 145,090 -> 262,144. That is 9.03x case C and
// 2.81x case D.
//
// The rule lands on the same integer as the pre-strip proposal, but it is not
// the same number: it now governs a payload 45% smaller, so the effective
// headroom over a real household roughly doubled. 145,090 sits just above
// 131,072, which is the only reason the next power of two is a full doubling.
export const REVIEW_MAX_BODY_BYTES = 262_144; // 256 KB

// ── Array-length caps ──────────────────────────────────────────────────────
//
// Set at 5x case C so nothing plausible trips them; these are a backstop that
// produces a nameable error, not the primary control (the body cap is).
export const MAX_INCOME_LINES = 60; // case C 12, case D 30, shipped capacity 4
export const MAX_FIXED_EXPENSE_LINES = 300; // case C 60, case D 200, shipped 21
export const MAX_VARIABLE_EXPENSE_LINES = 200; // case C 40, case D 150, shipped 13
export const MAX_SINKING_FUND_LINES = 150; // case C 30, case D 100, shipped 10
export const MAX_GOALS = 100; // case C 20, case D 50, shipped 7
export const MAX_HOUSEHOLD_KEYS = 150; // case C 30, case D 60, shipped sheet defines 14
// income + fixed + variable caps, matching how /api/plan assembles the list.
export const MAX_BUDGET_CATEGORIES = 560; // case C 112, case D 380

// ── String-length caps ─────────────────────────────────────────────────────
//
// Longest label measured anywhere was 80 chars (case D). 500 is 6.3x that.
// Lengths are counted in UTF-16 code units (String.prototype.length), which is
// what a person means by "characters" for the French/English text these
// fields hold; the body cap is what bounds raw bytes.
export const MAX_LABEL_CHARS = 500;
export const MAX_HOUSEHOLD_KEY_CHARS = 500;
// Household answers are free text ("Children, if any / Enfants, le cas
// échéant"), so a short paragraph is legitimate. 25x the longest measured.
export const MAX_HOUSEHOLD_VALUE_CHARS = 2_000;

// ---------------------------------------------------------------------------
// The one error type every guard throws.
//
// `code` is what the client switches on to choose a translated string; `error`
// prose is a fallback for an unrecognised code, never the primary channel.
// `field` names the offending path so the message can be specific about what
// the user has to shrink, rather than a bare "too large".
// ---------------------------------------------------------------------------
export const PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE' as const;

export class PromptInputTooLargeError extends Error {
  readonly code = PAYLOAD_TOO_LARGE;
  readonly field: string;
  readonly limit: number;
  readonly actual: number;

  constructor(field: string, limit: number, actual: number, message: string) {
    super(message);
    this.name = 'PromptInputTooLargeError';
    this.field = field;
    this.limit = limit;
    this.actual = actual;
    // Restores the prototype chain under ES5 downlevel emit, so `instanceof`
    // works in the route's catch. Without it a transpiled subclass of Error
    // fails the check and the route would report a 500 instead of a 413.
    Object.setPrototypeOf(this, PromptInputTooLargeError.prototype);
  }
}

export function isPromptInputTooLargeError(e: unknown): e is PromptInputTooLargeError {
  return e instanceof PromptInputTooLargeError;
}

// ---------------------------------------------------------------------------
// Primitive guards
// ---------------------------------------------------------------------------

/**
 * Byte cap on the raw request body, checked BEFORE JSON.parse so an oversized
 * payload is never materialised into an object graph.
 */
export function assertBodySize(raw: string, limit: number, field = 'body'): void {
  const actual = Buffer.byteLength(raw, 'utf8');
  if (actual > limit) {
    throw new PromptInputTooLargeError(
      field,
      limit,
      actual,
      `Request body is ${actual} bytes; the limit is ${limit} bytes.`
    );
  }
}

export function assertArrayLength(value: unknown[], field: string, limit: number): void {
  if (value.length > limit) {
    throw new PromptInputTooLargeError(
      field,
      limit,
      value.length,
      `${field} has ${value.length} entries; the limit is ${limit}.`
    );
  }
}

export function assertStringLength(value: string, field: string, limit: number): void {
  if (value.length > limit) {
    throw new PromptInputTooLargeError(
      field,
      limit,
      value.length,
      `${field} is ${value.length} characters; the limit is ${limit}.`
    );
  }
}

/** Reads an array field, tolerating null/undefined exactly as the routes do. */
function asArray(value: unknown, field: string): unknown[] {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    // Not a size problem, so not a 413 — mirror the TypeError the routes
    // already produce for a malformed body and let the 500 path handle it.
    throw new TypeError(`${field} must be an array`);
  }
  return value;
}

/** Validates one label/name string and returns it unchanged. */
function label(value: unknown, field: string): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  assertStringLength(s, field, MAX_LABEL_CHARS);
  return s;
}

// ---------------------------------------------------------------------------
// household — SHAPE allowlist, not a key allowlist (Phase 1 decision (c))
//
// `household` is Record<string, string> keyed by column 0 of the template's
// Household sheet. Those labels are fixed template text, so a key allowlist
// was possible — and was rejected deliberately: a household that renamed a
// field in Excel, or a future template revision, would have its answer
// silently dropped from the prompt. That is the same silent-degradation
// failure the reject-never-truncate rule exists to prevent, just relocated.
//
// The exploit was never the key names, it was unbounded bytes. So bound the
// bytes: count, key length, value length. Unknown keys are PRESERVED.
// ---------------------------------------------------------------------------
export function assertHouseholdShape(household: unknown): Record<string, string> {
  if (household == null) return {};
  if (typeof household !== 'object' || Array.isArray(household)) {
    throw new TypeError('parsed.household must be an object');
  }

  const entries = Object.entries(household as Record<string, unknown>);
  if (entries.length > MAX_HOUSEHOLD_KEYS) {
    throw new PromptInputTooLargeError(
      'parsed.household',
      MAX_HOUSEHOLD_KEYS,
      entries.length,
      `parsed.household has ${entries.length} fields; the limit is ${MAX_HOUSEHOLD_KEYS}.`
    );
  }

  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    assertStringLength(key, 'parsed.household key', MAX_HOUSEHOLD_KEY_CHARS);
    // Values are strings for every payload the parser can produce
    // (templateParser coerces with String(val).trim()). Requiring a string
    // here is what stops a nested object from being smuggled in and stringified
    // into the prompt.
    if (typeof value !== 'string') {
      throw new TypeError(`parsed.household["${key}"] must be a string`);
    }
    assertStringLength(value, `parsed.household["${key}"]`, MAX_HOUSEHOLD_VALUE_CHARS);
    out[key] = value;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Projected shapes — ONLY the fields the prompts actually read.
//
// Field lists were taken from the routes themselves, not from a summary:
//   income lines        api/plan/route.ts:102-105
//   fixed expense lines api/plan/route.ts:106-109
//   variable lines      api/plan/route.ts:110-112
//   sinking fund lines  api/plan/route.ts:120-128, :135
//   goals               api/plan/route.ts:88-94 (shape required by
//                       evaluateGoals/computeDebtPayoff, goalHelpers.ts:141,195)
//   summary             api/plan/route.ts:98-99, :131
//   calculated          api/plan/route.ts:143-148 + planHelpers.ts:74-84
//
// Key ORDER matters and is deliberate: these objects are re-serialised into
// the prompt, and preserving construction order keeps the prompt string
// byte-identical to the pre-fix output for every legitimate payload.
// Optional fields are emitted as `undefined` rather than omitted, because
// JSON.stringify drops undefined values — so a variable-expense line still
// serialises as {"label":…,"amount":…}, exactly as before.
// ---------------------------------------------------------------------------

export type ProjectedIncomeLine = {
  label: string;
  amount: number;
  rawAmount: number | undefined;
  frequency: IncomeFrequency | undefined;
  member: string | undefined;
};

export type ProjectedExpenseLine = {
  label: string;
  amount: number;
  rawAmount: number | undefined;
  frequency: IncomeFrequency | undefined;
};

export type ProjectedVariableLine = {
  label: string;
  amount: number;
};

export type ProjectedSinkingFundLine = {
  label: string;
  annualAmount: number;
  monthlyProvision: number;
  dueMonth: string;
};

export type ProjectedGoal = {
  name: string;
  targetAmount: number;
  savedSoFar: number;
  targetDate: string | null;
};

export type ProjectedTemplate = {
  household: Record<string, string>;
  summary: { monthlyIncome: number; monthlyExpenses: number; netCashFlow: number };
  income: { lines: ProjectedIncomeLine[] };
  fixedExpenses: { lines: ProjectedExpenseLine[] };
  variableExpenses: { lines: ProjectedVariableLine[] };
  sinkingFunds: { lines: ProjectedSinkingFundLine[] };
  goals: ProjectedGoal[];
};

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v ?? {}) as Rec;
const num = (v: unknown): number => v as number;

/**
 * /api/plan, `source: 'template'`. Validates sizes, then returns only the
 * fields the prompt and the budget assembly read.
 */
export function projectTemplateForPrompt(parsed: unknown): ProjectedTemplate {
  const p = rec(parsed);

  const household = assertHouseholdShape(p.household);

  const incomeRaw = asArray(rec(p.income).lines, 'parsed.income.lines');
  assertArrayLength(incomeRaw, 'parsed.income.lines', MAX_INCOME_LINES);

  const fixedRaw = asArray(rec(p.fixedExpenses).lines, 'parsed.fixedExpenses.lines');
  assertArrayLength(fixedRaw, 'parsed.fixedExpenses.lines', MAX_FIXED_EXPENSE_LINES);

  const variableRaw = asArray(rec(p.variableExpenses).lines, 'parsed.variableExpenses.lines');
  assertArrayLength(variableRaw, 'parsed.variableExpenses.lines', MAX_VARIABLE_EXPENSE_LINES);

  const sinkingRaw = asArray(rec(p.sinkingFunds).lines, 'parsed.sinkingFunds.lines');
  assertArrayLength(sinkingRaw, 'parsed.sinkingFunds.lines', MAX_SINKING_FUND_LINES);

  const goalsRaw = asArray(p.goals, 'parsed.goals');
  assertArrayLength(goalsRaw, 'parsed.goals', MAX_GOALS);

  const summary = rec(p.summary);

  return {
    household,
    summary: {
      monthlyIncome: num(summary.monthlyIncome),
      monthlyExpenses: num(summary.monthlyExpenses),
      netCashFlow: num(summary.netCashFlow),
    },
    income: {
      lines: incomeRaw.map((raw, i) => {
        const l = rec(raw);
        return {
          label: label(l.label, `parsed.income.lines[${i}].label`),
          amount: num(l.amount),
          rawAmount: l.rawAmount as number | undefined,
          frequency: l.frequency as IncomeFrequency | undefined,
          member:
            l.member === undefined
              ? undefined
              : label(l.member, `parsed.income.lines[${i}].member`),
        };
      }),
    },
    fixedExpenses: {
      lines: fixedRaw.map((raw, i) => {
        const l = rec(raw);
        return {
          label: label(l.label, `parsed.fixedExpenses.lines[${i}].label`),
          amount: num(l.amount),
          rawAmount: l.rawAmount as number | undefined,
          frequency: l.frequency as IncomeFrequency | undefined,
        };
      }),
    },
    variableExpenses: {
      lines: variableRaw.map((raw, i) => {
        const l = rec(raw);
        return {
          label: label(l.label, `parsed.variableExpenses.lines[${i}].label`),
          amount: num(l.amount),
        };
      }),
    },
    sinkingFunds: {
      lines: sinkingRaw.map((raw, i) => {
        const l = rec(raw);
        return {
          label: label(l.label, `parsed.sinkingFunds.lines[${i}].label`),
          annualAmount: num(l.annualAmount),
          monthlyProvision: num(l.monthlyProvision),
          dueMonth: label(l.dueMonth ?? '', `parsed.sinkingFunds.lines[${i}].dueMonth`),
        };
      }),
    },
    goals: goalsRaw.map((raw, i) => {
      const g = rec(raw);
      return {
        name: label(g.name, `parsed.goals[${i}].name`),
        targetAmount: num(g.targetAmount),
        savedSoFar: num(g.savedSoFar),
        targetDate: (g.targetDate ?? null) as string | null,
      };
    }),
  };
}

export type ProjectedCalculatedLine = {
  label: string;
  amount: number;
  rawAmount: number | undefined;
  frequency: IncomeFrequency | undefined;
};

export type ProjectedCalculated = {
  netCashFlow: number;
  income: { total: number; lines: ProjectedCalculatedLine[] };
  expenses: { total: number; lines: ProjectedCalculatedLine[] };
};

/**
 * /api/plan, `source: 'calculated'`. Manual entry has no household sheet, no
 * goals and no sinking funds — the route builds the whole budget from these
 * two line arrays (planHelpers.ts:74-84).
 */
export function projectCalculatedForPrompt(calculated: unknown): ProjectedCalculated {
  const c = rec(calculated);
  const income = rec(c.income);
  const expenses = rec(c.expenses);

  const incomeRaw = asArray(income.lines, 'calculated.income.lines');
  assertArrayLength(incomeRaw, 'calculated.income.lines', MAX_INCOME_LINES);

  const expenseRaw = asArray(expenses.lines, 'calculated.expenses.lines');
  // Manual entry has a single expense list; bound it by the fixed-expense cap,
  // the larger of the two expense caps, so the form is never the tighter path.
  assertArrayLength(expenseRaw, 'calculated.expenses.lines', MAX_FIXED_EXPENSE_LINES);

  const line = (raw: unknown, i: number, field: string): ProjectedCalculatedLine => {
    const l = rec(raw);
    return {
      label: label(l.label, `${field}[${i}].label`),
      amount: num(l.amount),
      rawAmount: l.rawAmount as number | undefined,
      frequency: l.frequency as IncomeFrequency | undefined,
    };
  };

  return {
    netCashFlow: num(c.netCashFlow),
    income: {
      total: num(income.total),
      lines: incomeRaw.map((r, i) => line(r, i, 'calculated.income.lines')),
    },
    expenses: {
      total: num(expenses.total),
      lines: expenseRaw.map((r, i) => line(r, i, 'calculated.expenses.lines')),
    },
  };
}

// ---------------------------------------------------------------------------
// /api/review-stream — the `plan` object, which is what /api/plan returned.
//
// Allowlist mirrors the plan assembled at api/plan/route.ts:230-244 exactly,
// including every GoalResult field (goalHelpers.ts:171-182) and every
// DebtPayoffResult field (goalHelpers.ts:129) — the review prompt narrates
// goals and the debt plan, so dropping one would degrade the letter silently.
// ---------------------------------------------------------------------------

export type ProjectedBudgetCategory = {
  name: string;
  budgeted: number;
  type: string;
  rawAmount: number | undefined;
  frequency: IncomeFrequency | undefined;
  member: string | undefined;
  seedCategory: string | undefined;
  isFixed: boolean | undefined;
};

export type ProjectedReviewPlan = {
  monthlyBudget: {
    totalIncome: number;
    totalExpenses: number;
    totalSavings: number;
    categories: ProjectedBudgetCategory[];
  };
  seedCategories: string[];
  sinkingFunds: {
    name: string;
    annualAmount: number;
    monthlyProvision: number;
    dueMonth: string;
    fundedAlready: boolean | undefined;
  }[];
  debtPayoff: { description: string; targetDate: string; monthlyPayment: number } | null;
  goals: {
    name: string;
    targetAmount: number;
    savedSoFar: number;
    hasTargetDate: boolean | undefined;
    targetDate: string | null;
    monthlyContribution: number | undefined;
    onTrack: boolean | undefined;
    fundedAlready: boolean | undefined;
    pastDue: boolean | undefined;
    estimatedDate: string | null | undefined;
  }[];
  topRecommendation: string;
};

export function projectPlanForReviewPrompt(plan: unknown): ProjectedReviewPlan {
  const p = rec(plan);
  const budget = rec(p.monthlyBudget);

  const categoriesRaw = asArray(budget.categories, 'plan.monthlyBudget.categories');
  assertArrayLength(categoriesRaw, 'plan.monthlyBudget.categories', MAX_BUDGET_CATEGORIES);

  const seedRaw = asArray(p.seedCategories, 'plan.seedCategories');
  assertArrayLength(seedRaw, 'plan.seedCategories', MAX_BUDGET_CATEGORIES);

  const sinkingRaw = asArray(p.sinkingFunds, 'plan.sinkingFunds');
  assertArrayLength(sinkingRaw, 'plan.sinkingFunds', MAX_SINKING_FUND_LINES);

  const goalsRaw = asArray(p.goals, 'plan.goals');
  assertArrayLength(goalsRaw, 'plan.goals', MAX_GOALS);

  const topRecommendation = label(p.topRecommendation ?? '', 'plan.topRecommendation');

  const debt = p.debtPayoff == null ? null : rec(p.debtPayoff);

  return {
    monthlyBudget: {
      totalIncome: num(budget.totalIncome),
      totalExpenses: num(budget.totalExpenses),
      totalSavings: num(budget.totalSavings),
      categories: categoriesRaw.map((raw, i) => {
        const c = rec(raw);
        return {
          name: label(c.name, `plan.monthlyBudget.categories[${i}].name`),
          budgeted: num(c.budgeted),
          type: c.type as string,
          rawAmount: c.rawAmount as number | undefined,
          frequency: c.frequency as IncomeFrequency | undefined,
          member:
            c.member === undefined
              ? undefined
              : label(c.member, `plan.monthlyBudget.categories[${i}].member`),
          seedCategory: c.seedCategory as string | undefined,
          isFixed: c.isFixed as boolean | undefined,
        };
      }),
    },
    seedCategories: seedRaw.map((s, i) => label(s, `plan.seedCategories[${i}]`)),
    sinkingFunds: sinkingRaw.map((raw, i) => {
      const s = rec(raw);
      return {
        name: label(s.name, `plan.sinkingFunds[${i}].name`),
        annualAmount: num(s.annualAmount),
        monthlyProvision: num(s.monthlyProvision),
        dueMonth: label(s.dueMonth ?? '', `plan.sinkingFunds[${i}].dueMonth`),
        fundedAlready: s.fundedAlready as boolean | undefined,
      };
    }),
    debtPayoff:
      debt === null
        ? null
        : {
            description: label(debt.description ?? '', 'plan.debtPayoff.description'),
            targetDate: debt.targetDate as string,
            monthlyPayment: num(debt.monthlyPayment),
          },
    goals: goalsRaw.map((raw, i) => {
      const g = rec(raw);
      return {
        name: label(g.name, `plan.goals[${i}].name`),
        targetAmount: num(g.targetAmount),
        savedSoFar: num(g.savedSoFar),
        hasTargetDate: g.hasTargetDate as boolean | undefined,
        targetDate: (g.targetDate ?? null) as string | null,
        monthlyContribution: g.monthlyContribution as number | undefined,
        onTrack: g.onTrack as boolean | undefined,
        fundedAlready: g.fundedAlready as boolean | undefined,
        pastDue: g.pastDue as boolean | undefined,
        estimatedDate: g.estimatedDate as string | null | undefined,
      };
    }),
    topRecommendation,
  };
}
