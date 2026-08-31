import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/anthropic';
import { dedupeSinkingFunds, assembleCalculatedBudget } from '@phare/core';
import { evaluateGoals, GoalResult, isDebtGoalName, computeDebtPayoff, DebtPayoffResult } from '@/lib/goalHelpers';
import { businessToday, DEFAULT_HOUSEHOLD_TIMEZONE } from '@phare/core';
import { createRateLimiter, clientIp } from '@/lib/rateLimit';
import { requireOnboardingGeneration } from '@/lib/onboardingAuth';
import { PLAN_GENERATION_EVENT } from '@/lib/onboardingQuota';
import {
  PLAN_MAX_BODY_BYTES,
  assertBodySize,
  projectTemplateForPrompt,
  projectCalculatedForPrompt,
  isPromptInputTooLargeError,
} from '@/lib/promptInputLimits';

// AUTHENTICATED, and quota'd per household. It was neither until now.
//
// The old header argued this route needed no session because it "reads nothing
// from the database" — true of the plan assembly, and beside the point. The
// exposure was never tenancy, it was SPEND: every call bills Anthropic, and the
// only thing in front of it was an in-process IP limiter that does not bind
// (a Map per lambda, keyed on x-forwarded-for, which carrier CGNAT collapses to
// one address for many households at once).
//
// So the gate is now identity plus a counted, DB-backed monthly allowance —
// see onboardingQuota.ts for the numbers and for an honest statement of what a
// per-household quota does and does not buy on a product with free signup.
//
// The IP limiter is KEPT as a cheap in-process burst damper in front of the
// database round trips, and is no longer load-bearing. It does not bind across
// instances and must not be described as though it does.
const rateLimit = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 8 });

const SEED_CATEGORIES = [
  'Housing', 'Transportation', 'Restaurants', 'Groceries & Pharmacy',
  'Utilities & Subscriptions', 'Childcare', 'Shopping',
  'Health & Personal', 'Installments', 'Unexpected',
] as const;

type Category = {
  name: string;
  budgeted: number;
  type: string;
  rawAmount?: number;
  frequency?: 'weekly' | 'biweekly' | 'semimonthly' | 'monthly';
  member?: string;
};

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit(clientIp(request));
    if (!limit.allowed) {
      return NextResponse.json(
        { code: 'RATE_LIMITED', error: 'Too many plan requests. Please wait a moment and try again.', retryAfterSeconds: limit.retryAfterSeconds },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    // IDENTITY, THEN ALLOWANCE — both before the body is even read, so an
    // unauthenticated or exhausted caller never costs a parse, let alone a
    // model call. reserve-then-generate: the slot is claimed here, so a prompt
    // that fails downstream cannot be retried without limit.
    const gate = await requireOnboardingGeneration(PLAN_GENERATION_EVENT);
    if (!gate.ok) return gate.response;

    // SIZE BEFORE PARSE. The body is weighed as raw text so an oversized
    // payload is refused without ever being materialised into an object graph
    // — and, more to the point, without reaching a prompt. See
    // lib/promptInputLimits.ts for how the cap was derived.
    const raw = await request.text();
    try {
      assertBodySize(raw, PLAN_MAX_BODY_BYTES, 'body');
    } catch (err) {
      if (isPromptInputTooLargeError(err)) {
        return NextResponse.json(
          { code: err.code, error: err.message, field: err.field, limit: err.limit, actual: err.actual },
          { status: 413 }
        );
      }
      throw err;
    }

    let body: {
      source?: string;
      locale?: string;
      parsed?: unknown;
      calculated?: unknown;
    };
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json(
        { code: 'INVALID_JSON', error: 'Request body was not valid JSON.' },
        { status: 400 }
      );
    }

    const locale = body.locale === 'fr' ? 'fr' : 'en';
    const lang = locale === 'fr' ? 'French (Quebec French, natural and native)' : 'English';

    let monthlyBudget: {
      totalIncome: number;
      totalExpenses: number;
      totalSavings: number;
      categories: Category[];
    };
    let sinkingFundsFromData: { name: string; annualAmount: number; monthlyProvision: number; dueMonth: string }[] | null = null;
    let aiContext: string;
    // Goals are code-computed for template source (real user-stated targets —
    // "Code owns math" applies) and stay AI-suggested for calculated source
    // (no real target data exists yet to violate; the AI is brainstorming
    // ideas, not asserting facts about something the user actually asked for).
    let computedGoals: GoalResult[] | null = null;
    // debtPayoff joins the code-owned side too — computed from the debt
    // goal's own parsed target date/amount via the same requiredMonthlyContribution
    // every other goal uses. Never AI-emitted, for either source.
    let computedDebtPayoff: DebtPayoffResult | null = null;

    try {
      if (body.source === 'template') {
        // ALLOWLIST PROJECTION. `p` carries only the fields this route and its
        // prompt actually read — nothing else from the request can reach the
        // model. household is shape-validated (count/key/value bounds) rather
        // than key-allowlisted, so a household that renamed a field in Excel
        // keeps its answer instead of having it silently dropped.
        const p = projectTemplateForPrompt(body.parsed);
        // A household DOES exist by now (the signup trigger creates one), but
        // this route is unauthenticated and reads nothing from the database, so
        // it has no session with which to look one up. It therefore uses the
        // same value the households.timezone column itself defaults to
        // ('America/Toronto') — exactly right for the household that was just
        // created at signup.
        //
        // KNOWN GAP, deliberately left alone here: a household that changed its
        // timezone and then re-runs onboarding (the save-plan confirmReplace
        // path) is dated against the default rather than its own zone. It moves
        // goal evaluation by at most a day at a boundary. Once saved,
        // downstream routes resolve the real per-household timezone.
        const today = businessToday(DEFAULT_HOUSEHOLD_TIMEZONE);
        const rawGoals = p.goals;
        // The debt-payoff line (if any) gets its own card, not a duplicate goal
        // card — pulled out before the rest go through evaluateGoals().
        const debtGoalLine = rawGoals.find((g) => isDebtGoalName(g.name));
        const nonDebtGoals = rawGoals.filter((g) => g !== debtGoalLine);
        computedDebtPayoff = computeDebtPayoff(debtGoalLine, today);
        computedGoals = evaluateGoals(nonDebtGoals, p.summary.netCashFlow, today);

        // ----- TypeScript assembles the budget. Exact, instant. -----
        monthlyBudget = {
          totalIncome: p.summary.monthlyIncome,
          totalExpenses: p.summary.monthlyExpenses,
          totalSavings: p.summary.netCashFlow,
          categories: [
            ...p.income.lines.map((l) => ({
              name: l.label, budgeted: l.amount, type: 'income',
              rawAmount: l.rawAmount, frequency: l.frequency, member: l.member,
            })),
            ...p.fixedExpenses.lines.map((l) => ({
              name: l.label, budgeted: l.amount, type: 'expense',
              rawAmount: l.rawAmount, frequency: l.frequency,
            })),
            ...p.variableExpenses.lines.map((l) => ({
              name: l.label, budgeted: l.amount, type: 'expense',
            })),
          ],
        };

        // Sinking funds come straight from the template. Exact. fundedAlready
        // is always false here — onboarding has no account/balance concept yet,
        // there is nothing a fund could be funded from at this stage — so the
        // review must narrate these as a plan, never as money already moving.
        sinkingFundsFromData = p.sinkingFunds.lines.map((l) => ({
          name: l.label,
          annualAmount: l.annualAmount,
          monthlyProvision: l.monthlyProvision,
          dueMonth: l.dueMonth,
          fundedAlready: false,
        }));

        aiContext = `Household info: ${JSON.stringify(p.household)}
Net cash flow: $${p.summary.netCashFlow}/month (income $${p.summary.monthlyIncome}, expenses $${p.summary.monthlyExpenses}, savings $0 at plan creation)
Accounting model: net = income − expenses − savings (savings = actual transfers to goal accounts; none exist yet)
Their goals — ALREADY verified, do not recompute or contradict these numbers, just narrate them naturally where relevant: ${JSON.stringify(computedGoals)}
Their debt payoff — ALREADY verified (null means no debt evident or nothing computable), do not recompute or contradict: ${JSON.stringify(computedDebtPayoff)}
Their sinking funds (already set up): ${JSON.stringify(p.sinkingFunds.lines)}
Expense lines: ${JSON.stringify([...p.fixedExpenses.lines, ...p.variableExpenses.lines].map((l) => l.label))}`;
      } else if (body.source === 'calculated') {
        const c = projectCalculatedForPrompt(body.calculated);

        // assembleCalculatedBudget sets totalSavings = 0 (not income − expenses).
        // Savings appear later as real transfers; using the residual here would
        // produce a wrong net once transfers are recorded.
        monthlyBudget = assembleCalculatedBudget(c);

        aiContext = `Net cash flow: $${c.netCashFlow}/month (income $${c.income.total}, expenses $${c.expenses.total}, savings $0 at plan creation)
Accounting model: net = income − expenses − savings (savings = actual transfers to goal accounts; none exist yet)
Income lines: ${JSON.stringify(c.income.lines)}
Expense lines: ${JSON.stringify(c.expenses.lines)}
This household entered ONLY these income and expense lines. They have NOT set any savings goals or reserve funds. Do not invent any — you may suggest one or two in your topRecommendation prose, framed explicitly as a suggestion ("Consider a property-tax fund — Quebec bills land in March and June"), but never as a fund or goal they already have, and never with a specific monthly amount presented as theirs.`;
      } else {
        return NextResponse.json(
          { code: 'UNKNOWN_PLAN_SOURCE', error: 'Unknown plan source' },
          { status: 400 }
        );
      }
    } catch (err) {
      // A size violation inside the projection is the user's to fix, and the
      // message names the exact field and limit — never a bare "bad request".
      if (isPromptInputTooLargeError(err)) {
        return NextResponse.json(
          { code: err.code, error: err.message, field: err.field, limit: err.limit, actual: err.actual },
          { status: 413 }
        );
      }
      throw err;
    }

    // ----- Claude does ONLY the interpretive part, in the user's language -----
    // The AI may NEVER instantiate structured objects — sinking-fund rows,
    // goal cards, debt-payoff cards. Those come from user input or code only:
    //   - sinking funds: from the template's Annual Expenses sheet
    //     (sinkingFundsFromData) or none at all. The AI never emits them.
    //   - goals: template → evaluateGoals() (code); calculated → none.
    //   - debtPayoff: template → computeDebtPayoff() (code), from the debt
    //     goal's own parsed target date/amount; calculated → always null (no
    //     structured debt input exists on that path).
    // The AI's JSON request has NO slot for any of these, for either source —
    // it returns ONLY line classifications and prose. Suggestions live in
    // topRecommendation / the monthly review, framed as suggestions, never as
    // rows or cards with computed amounts.
    const isTemplate = body.source === 'template';
    const categoryList = SEED_CATEGORIES.join(', ');

    const prompt = `You are Phare, a financial planning system for Canadian households. The numbers below are VERIFIED — calculated from the household's data. Do not change or recalculate them.

${aiContext}

Write ALL text in ${lang}.

Return ONLY valid JSON:
{"lineClassifications":[{"label":"","category":"","isFixed":true}],"topRecommendation":""}

Rules:
- All descriptions and topRecommendation text in ${lang}.
- lineClassifications: for EACH expense line label provided, return an object with:
  - "label": the exact expense line label as given
  - "category": which ONE of these fits best: ${categoryList}. Use the English category name exactly as written here.
  - "isFixed": true if it is a fixed recurring bill paid every month (mortgage, rent, loan payment, insurance, daycare, utilities, phone, subscriptions); false if it is variable day-to-day spending (groceries, restaurants, gas, shopping).
- Classify income lines too: category "Income", isFixed true.
- Do NOT output any reserve funds, goals, or debt payoff as structured data — there is no field for them in the JSON above. If you want to suggest one, put it in topRecommendation as a suggestion phrased as a suggestion ("Consider…"), never as a fund/goal/debt-plan they already have and never with a monthly amount presented as theirs.
${isTemplate ? '- Their goals and debt payoff are already evaluated (contribution, on-track verdict, and dates are all real, verified numbers) — do not invent or restate any of those figures anywhere; if you reference one in topRecommendation, use the exact numbers given.' : ''}
- Vocabulary: never write "code", "computed in code", or similar internal/technical phrasing — a reader must never see the word "code". An estimated date or figure reads as a plain estimate (e.g. "estimated: March 2027"), never "code-estimated". Never call a figure "budgeted" unless the household actually set that budget themselves — a computed or projected amount (including a card/bridge payment total) reads as "expected", not "budgeted".
- Canadian context: RRSP reduces taxable income (flag Quebec resident + Ontario employer tax gap if household info shows it). RESP gives $500/yr CESG per child on $2,500 contributed. TFSA is ideal for reserve funds.
- If net cash flow is negative, topRecommendation must address that first.
- topRecommendation: one specific sentence with a dollar amount.`;

    // UPSTREAM FAILURE IS ITS OWN OUTCOME, not a generic 500. With a spend cap
    // on the Anthropic key, a quota refusal is now a reachable state that did
    // not exist before, and it arrives here as a thrown SDK error
    // indistinguishable (to this catch) from an outage or a timeout. All of
    // them mean the same thing to the family: the plan could not be written
    // right now and retrying later is the remedy. The client maps
    // AI_UNAVAILABLE to translated copy, so this never surfaces as a bare
    // English sentence inside a French screen.
    let message;
    try {
      message = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
    } catch (aiError) {
      console.error('Plan generation — Anthropic call failed:', aiError);
      return NextResponse.json(
        { code: 'AI_UNAVAILABLE', error: 'The planning service is unavailable right now. Please try again in a few minutes.' },
        { status: 503 }
      );
    }

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    const aiPart = JSON.parse(responseText.replace(/```json|```/g, '').trim());

    // ----- Assemble final plan: verified numbers + AI interpretation -----
    // Sinking funds are user-sheet-derived (template) or empty (calculated) —
    // never AI-invented. aiPart is not consulted for them.
    const finalSinkingFunds = sinkingFundsFromData ?? [];

    monthlyBudget.categories = dedupeSinkingFunds(monthlyBudget.categories, finalSinkingFunds);

    // Map each line label → its AI classification (category + isFixed)
    const classMap = new Map<string, { category: string; isFixed: boolean }>();
    for (const lc of (aiPart.lineClassifications ?? [])) {
      if (lc?.label) {
        classMap.set(lc.label.trim().toLowerCase(), {
          category: lc.category || 'Unexpected',
          isFixed: !!lc.isFixed,
        });
      }
    }

    // Attach classification to each budget category line
    const classifiedCategories = monthlyBudget.categories.map((cat) => {
      const cls = classMap.get(cat.name.trim().toLowerCase());
      return {
        ...cat,
        seedCategory: cat.type === 'income' ? 'Income' : (cls?.category ?? 'Unexpected'),
        isFixed: cat.type === 'income' ? true : (cls?.isFixed ?? false),
      };
    });

    const plan = {
      monthlyBudget: { ...monthlyBudget, categories: classifiedCategories },
      seedCategories: SEED_CATEGORIES,
      sinkingFunds: finalSinkingFunds,
      // Code-computed by computeDebtPayoff() (template) or null (calculated) —
      // aiPart is never consulted for this, mirroring goals/sinking funds.
      debtPayoff: computedDebtPayoff,
      // Template source: code-computed by evaluateGoals(). Calculated source:
      // empty — goals are user-entered or absent, never AI-fabricated. (When
      // manual entry later captures target dates, they flow through
      // evaluateGoals() identically — this closes the old "manual goals stay
      // AI-suggested" exception.)
      goals: computedGoals ?? [],
      topRecommendation: aiPart.topRecommendation ?? '',
    };

    return NextResponse.json({ plan });
  } catch (error) {
    console.error('Plan generation error:', error);
    return NextResponse.json(
      { code: 'PLAN_FAILED', error: 'Failed to generate financial plan' },
      { status: 500 }
    );
  }
}
