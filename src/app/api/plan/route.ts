import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/anthropic';
import { dedupeSinkingFunds, assembleCalculatedBudget } from '@/lib/planHelpers';
import { evaluateGoals, GoalResult, isDebtGoalName, computeDebtPayoff, DebtPayoffResult } from '@/lib/goalHelpers';
import { businessToday, DEFAULT_HOUSEHOLD_TIMEZONE } from '@/lib/dateHelpers';

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
    const body = await request.json();
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

    if (body.source === 'template') {
      const p = body.parsed;
      // No household row exists yet at this pre-signup preview stage (see
      // upload/page.tsx) — nothing to read a timezone from, so this uses
      // the same default every fresh household gets. Once saved (save-plan),
      // downstream routes resolve the real per-household timezone.
      const today = businessToday(DEFAULT_HOUSEHOLD_TIMEZONE);
      const rawGoals: { name: string; targetAmount: number; savedSoFar: number; targetDate: string | null }[] = p.goals ?? [];
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
          ...p.income.lines.map((l: { label: string; amount: number; rawAmount?: number; frequency?: Category['frequency']; member?: string }) => ({
            name: l.label, budgeted: l.amount, type: 'income',
            rawAmount: l.rawAmount, frequency: l.frequency, member: l.member,
          })),
          ...p.fixedExpenses.lines.map((l: { label: string; amount: number; rawAmount?: number; frequency?: Category['frequency'] }) => ({
            name: l.label, budgeted: l.amount, type: 'expense',
            rawAmount: l.rawAmount, frequency: l.frequency,
          })),
          ...p.variableExpenses.lines.map((l: { label: string; amount: number }) => ({
            name: l.label, budgeted: l.amount, type: 'expense',
          })),
        ],
      };

      // Sinking funds come straight from the template. Exact.
      sinkingFundsFromData = p.sinkingFunds.lines.map(
        (l: { label: string; annualAmount: number; monthlyProvision: number; dueMonth: string }) => ({
          name: l.label,
          annualAmount: l.annualAmount,
          monthlyProvision: l.monthlyProvision,
          dueMonth: l.dueMonth,
        })
      );

      aiContext = `Household info: ${JSON.stringify(p.household)}
Net cash flow: $${p.summary.netCashFlow}/month (income $${p.summary.monthlyIncome}, expenses $${p.summary.monthlyExpenses}, savings $0 at plan creation)
Accounting model: net = income − expenses − savings (savings = actual transfers to goal accounts; none exist yet)
Their goals — ALREADY verified, do not recompute or contradict these numbers, just narrate them naturally where relevant: ${JSON.stringify(computedGoals)}
Their debt payoff — ALREADY verified (null means no debt evident or nothing computable), do not recompute or contradict: ${JSON.stringify(computedDebtPayoff)}
Their sinking funds (already set up): ${JSON.stringify(p.sinkingFunds.lines)}
Expense lines: ${JSON.stringify([...p.fixedExpenses.lines, ...p.variableExpenses.lines].map((l: { label: string }) => l.label))}`;
    } else if (body.source === 'calculated') {
      const c = body.calculated;

      // assembleCalculatedBudget sets totalSavings = 0 (not income − expenses).
      // Savings appear later as real transfers; using the residual here would
      // produce a wrong net once transfers are recorded.
      monthlyBudget = assembleCalculatedBudget(c);

      aiContext = `Net cash flow: $${c.netCashFlow}/month (income $${c.income.total}, expenses $${c.expenses.total}, savings $0 at plan creation)
Accounting model: net = income − expenses − savings (savings = actual transfers to goal accounts; none exist yet)
Income lines: ${JSON.stringify(c.income.lines)}
Expense lines: ${JSON.stringify(c.expenses.lines)}
This family entered ONLY these income and expense lines. They have NOT set any savings goals or sinking funds. Do not invent any — you may suggest one or two in your topRecommendation prose, framed explicitly as a suggestion ("Consider a property-tax fund — Quebec bills land in March and June"), but never as a fund or goal they already have, and never with a specific monthly amount presented as theirs.`;
    } else {
      return NextResponse.json({ error: 'Unknown plan source' }, { status: 400 });
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

    const prompt = `You are Phare, an AI financial coach for Canadian families. The numbers below are VERIFIED — calculated from the family's data. Do not change or recalculate them.

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
- Do NOT output any sinking funds, goals, or debt payoff as structured data — there is no field for them in the JSON above. If you want to suggest one, put it in topRecommendation as a suggestion phrased as a suggestion ("Consider…"), never as a fund/goal/debt-plan they already have and never with a monthly amount presented as theirs.
${isTemplate ? '- Their goals and debt payoff are already evaluated (contribution, on-track verdict, and dates are all real, verified numbers) — do not invent or restate any of those figures anywhere; if you reference one in topRecommendation, use the exact numbers given.' : ''}
- Vocabulary: never write "code", "computed in code", or similar internal/technical phrasing — a reader must never see the word "code". An estimated date or figure reads as a plain estimate (e.g. "estimated: March 2027"), never "code-estimated". Never call a figure "budgeted" unless the family actually set that budget themselves — a computed or projected amount (including a card/bridge payment total) reads as "expected", not "budgeted".
- Canadian context: RRSP reduces taxable income (flag Quebec resident + Ontario employer tax gap if household info shows it). RESP gives $500/yr CESG per child on $2,500 contributed. TFSA is ideal for sinking funds.
- If net cash flow is negative, topRecommendation must address that first.
- topRecommendation: one specific sentence with a dollar amount.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

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
      { error: 'Failed to generate financial plan' },
      { status: 500 }
    );
  }
}