import { NextRequest, NextResponse } from 'next/server';
import { anthropic } from '@/lib/anthropic';
import { dedupeSinkingFunds, assembleCalculatedBudget } from '@/lib/planHelpers';

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

    if (body.source === 'template') {
      const p = body.parsed;

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
Their stated goals: ${JSON.stringify(p.goals)}
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
No goals or sinking funds were provided — suggest sinking funds based on the expense labels and typical Canadian annual costs.`;
    } else {
      return NextResponse.json({ error: 'Unknown plan source' }, { status: 400 });
    }

    // ----- Claude does ONLY the interpretive part, in the user's language -----
    const needsSinkingFunds = sinkingFundsFromData === null;
    const categoryList = SEED_CATEGORIES.join(', ');

    const prompt = `You are Phare, an AI financial coach for Canadian families. The numbers below are VERIFIED — computed in code from the family's data. Do not change or recalculate them.

${aiContext}

Write ALL text in ${lang}.

Return ONLY valid JSON:
{${needsSinkingFunds ? '"sinkingFunds":[{"name":"","annualAmount":0,"monthlyProvision":0,"dueMonth":""}],' : ''}"lineClassifications":[{"label":"","category":"","isFixed":true}],"goals":[{"name":"","targetAmount":0,"monthlyContribution":0,"onTrack":true,"estimatedDate":""}],"debtPayoff":{"description":"","targetDate":"","monthlyPayment":0},"topRecommendation":""}

Rules:
- All goal names, descriptions, and topRecommendation text in ${lang}.
- lineClassifications: for EACH expense line label provided, return an object with:
  - "label": the exact expense line label as given
  - "category": which ONE of these fits best: ${categoryList}. Use the English category name exactly as written here.
  - "isFixed": true if it is a fixed recurring bill paid every month (mortgage, rent, loan payment, insurance, daycare, utilities, phone, subscriptions); false if it is variable day-to-day spending (groceries, restaurants, gas, shopping).
- Classify income lines too: category "Income", isFixed true.
${needsSinkingFunds ? '- Suggest 3-6 sinking funds for likely Canadian annual expenses inferred from the expense labels (property tax March & June in Quebec, car registration, back to school, income tax balance, Christmas).' : ''}
- goals: ${body.source === 'template' ? 'assess THEIR stated goals — compute monthlyContribution as (target - saved) / months to target date, mark onTrack based on whether net cash flow covers it' : 'suggest 2-3 sensible goals based on their situation (emergency fund of 3 months expenses, RESP if children evident, debt payoff if debt evident)'}.
- Canadian context: RRSP reduces taxable income (flag Quebec resident + Ontario employer tax gap if household info shows it). RESP gives $500/yr CESG per child on $2,500 contributed. TFSA is ideal for sinking funds.
- If net cash flow is negative, topRecommendation must address that first.
- If no debt is evident, set debtPayoff to null.
- topRecommendation: one specific sentence with a dollar amount.`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    });

    const responseText = message.content[0].type === 'text' ? message.content[0].text : '';
    const aiPart = JSON.parse(responseText.replace(/```json|```/g, '').trim());

    // ----- Assemble final plan: verified numbers + AI interpretation -----
    const finalSinkingFunds = sinkingFundsFromData ?? aiPart.sinkingFunds ?? [];

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
      debtPayoff: aiPart.debtPayoff ?? null,
      goals: aiPart.goals ?? [],
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