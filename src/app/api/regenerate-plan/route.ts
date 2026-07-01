/**
 * POST /api/regenerate-plan
 *
 * Re-runs the financial plan and review against the household's CURRENT live
 * data (recurring items + category budgets), then saves a new conversation row.
 * Does NOT touch accounts, transactions, or budgets — this is interpretation
 * only.
 *
 * This is the foundation for monthly review delivery: the review always reads
 * current data, never onboarding-time data.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { anthropic } from '@/lib/anthropic';
import { assembleCalculatedBudget, dedupeSinkingFunds } from '@/lib/planHelpers';

const SEED_CATEGORIES = [
  'Housing', 'Transportation', 'Restaurants', 'Groceries & Pharmacy',
  'Utilities & Subscriptions', 'Childcare', 'Shopping',
  'Health & Personal', 'Installments', 'Unexpected',
] as const;

type Category = { name: string; budgeted: number; type: string };

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function POST(request: Request) {
  try {
    const { locale: rawLocale } = await request.json().catch(() => ({ locale: 'en' }));
    const locale = rawLocale === 'fr' ? 'fr' : 'en';
    const lang = locale === 'fr' ? 'French (Quebec French, natural and native)' : 'English';

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    // ── Read current live data ──────────────────────────────────────────────

    const [recurringResult, budgetsResult, sfResult] = await Promise.all([
      supabase
        .from('recurring_items')
        .select('description, amount, type, cadence')
        .eq('household_id', householdId)
        .eq('active', true),

      supabase
        .from('budgets')
        .select('amount, categories(name, type)')
        .eq('household_id', householdId),

      supabase
        .from('sinking_funds')
        .select('name, annual_amount, monthly_provision, due_month')
        .eq('household_id', householdId),
    ]);

    const recurringItems = recurringResult.data ?? [];
    const budgetRows = budgetsResult.data ?? [];
    const sinkingFunds = sfResult.data ?? [];

    // Income: recurring items stored at their monthly equivalent (cadence='monthly').
    const incomeLines = recurringItems
      .filter((r) => r.type === 'income')
      .map((r) => ({ label: r.description, amount: round(Number(r.amount)) }));

    const incomeTotal = round(incomeLines.reduce((s, l) => s + l.amount, 0));

    // Expenses: fixed recurring expenses + variable category budgets.
    const fixedExpenseLines = recurringItems
      .filter((r) => r.type === 'expense')
      .map((r) => ({ label: r.description, amount: round(Number(r.amount)) }));

    // Supabase returns the joined categories relation as an object or null.
    // Cast through unknown to avoid the generated-type array/object mismatch.
    type BudgetRow = { amount: unknown; categories: { name: string; type: string } | null };
    const variableExpenseLines = (budgetRows as unknown as BudgetRow[])
      .filter((b) => b.categories?.type === 'expense')
      .map((b) => ({ label: b.categories!.name, amount: round(Number(b.amount)) }));

    const allExpenseLines = [...fixedExpenseLines, ...variableExpenseLines];
    const expenseTotal = round(allExpenseLines.reduce((s, l) => s + l.amount, 0));
    const netCashFlow = round(incomeTotal - expenseTotal);

    const calculated = {
      income: { detected: incomeLines.length > 0, lines: incomeLines, total: incomeTotal },
      expenses: { detected: allExpenseLines.length > 0, lines: allExpenseLines, total: expenseTotal },
      netCashFlow,
      excludedLines: [],
      confidence: 'high',
    };

    const monthlyBudget = assembleCalculatedBudget(calculated);

    const aiContext = `Net cash flow: $${netCashFlow}/month (income $${incomeTotal}, expenses $${expenseTotal})
Accounting model: net = income − expenses − savings (savings = actual transfers to goal accounts)
Income lines: ${JSON.stringify(incomeLines)}
Expense lines: ${JSON.stringify(allExpenseLines)}
No goals or sinking funds provided — suggest based on expense labels and typical Canadian annual costs.`;

    // ── Generate plan (AI interpretation only — numbers already computed) ───

    const categoryList = SEED_CATEGORIES.join(', ');
    const planPrompt = `You are Phare, an AI financial coach for Canadian families. The numbers below are VERIFIED — computed in code from the family's data. Do not change or recalculate them.

${aiContext}

Write ALL text in ${lang}.

Return ONLY valid JSON:
{"sinkingFunds":[{"name":"","annualAmount":0,"monthlyProvision":0,"dueMonth":""}],"lineClassifications":[{"label":"","category":"","isFixed":true}],"goals":[{"name":"","targetAmount":0,"monthlyContribution":0,"onTrack":true,"estimatedDate":""}],"debtPayoff":{"description":"","targetDate":"","monthlyPayment":0},"topRecommendation":""}

Rules:
- All goal names, descriptions, and topRecommendation text in ${lang}.
- lineClassifications: for EACH expense line label provided, return an object with:
  - "label": the exact expense line label as given
  - "category": which ONE of these fits best: ${categoryList}. Use the English category name exactly as written here.
  - "isFixed": true if it is a fixed recurring bill paid every month; false if variable day-to-day spending.
- Classify income lines too: category "Income", isFixed true.
- Suggest 3-6 sinking funds for likely Canadian annual expenses inferred from the expense labels.
- goals: suggest 2-3 sensible goals based on their situation (emergency fund of 3 months expenses, RESP if children evident, debt payoff if debt evident).
- Canadian context: RRSP, RESP, TFSA, CESG.
- If net cash flow is negative, topRecommendation must address that first.
- If no debt is evident, set debtPayoff to null.
- topRecommendation: one specific sentence with a dollar amount.`;

    const planMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: planPrompt }],
    });

    const planText = planMessage.content[0].type === 'text' ? planMessage.content[0].text : '';
    const aiPart = JSON.parse(planText.replace(/```json|```/g, '').trim());

    // Map sinking funds from DB if available, otherwise use AI suggestions
    const finalSinkingFunds = sinkingFunds.length > 0
      ? sinkingFunds.map((sf) => ({
          name: sf.name,
          annualAmount: Number(sf.annual_amount),
          monthlyProvision: Number(sf.monthly_provision),
          dueMonth: sf.due_month ?? '',
        }))
      : (aiPart.sinkingFunds ?? []);

    const classMap = new Map<string, { category: string; isFixed: boolean }>();
    for (const lc of (aiPart.lineClassifications ?? [])) {
      if (lc?.label) {
        classMap.set(lc.label.trim().toLowerCase(), {
          category: lc.category || 'Unexpected',
          isFixed: !!lc.isFixed,
        });
      }
    }

    const deduped = dedupeSinkingFunds(monthlyBudget.categories, finalSinkingFunds);
    const classifiedCategories = deduped.map((cat: Category) => {
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

    // ── Generate review (blocking, not streamed) ────────────────────────────

    const reviewPrompt = `You are Phare, an AI financial coach for Canadian families. Write this family's monthly review in ${lang}.

Their plan:
${JSON.stringify(plan)}

Write four paragraphs maximum. Specific numbers. One clear recommendation. Plain language. It must feel like a letter from a trusted financial advisor, not a report.

Good tone: "June was a solid month overall. You stayed within budget in four of five categories..."
Bad tone: "Based on a comprehensive analysis of your financial data..."

Start with what is going well, then what to watch, then the one thing to do this month. Write ONLY the review text, no preamble, no headings.`;

    const reviewMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: reviewPrompt }],
    });

    const reviewText = reviewMessage.content[0].type === 'text' ? reviewMessage.content[0].text : '';

    // ── Save new conversation row ───────────────────────────────────────────

    await supabase.from('conversations').insert({
      household_id: householdId,
      user_id: user.id,
      type: 'monthly_review',
      messages: [
        { role: 'assistant', type: 'top_recommendation', content: plan.topRecommendation, locale },
        { role: 'assistant', type: 'monthly_review', content: reviewText, locale },
      ],
    });

    return NextResponse.json({ saved: true, topRecommendation: plan.topRecommendation, reviewText });
  } catch (error) {
    console.error('Regenerate plan error:', error);
    return NextResponse.json({ error: 'Failed to regenerate plan' }, { status: 500 });
  }
}
