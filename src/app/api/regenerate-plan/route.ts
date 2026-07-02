/**
 * POST /api/regenerate-plan
 *
 * Re-runs the financial plan and review against the household's CURRENT live
 * data, then saves a new conversation row.
 *
 * INCOME SOURCE OF TRUTH
 * ----------------------
 * Income comes from the transactions table for the current calendar month —
 * the same rows the Expenses page sums via computeMonthTotals. This is the
 * only correct source because:
 *
 *   - recurring_items stores per-paycheque amounts (e.g. $2,749 bi-weekly)
 *   - summing recurring_items.amount without frequency multiplication produces
 *     one-of-each-source: $2,749 + $2,742 + $383 = $5,874 ← the exact bug
 *   - transactions are materialized at save time with the real cadence, so a
 *     bi-weekly earner already has 2 or 3 rows in the month — exactly what the
 *     ledger shows (e.g. 3-paycheque July = $14,115)
 *
 * The AI receives pre-computed verified numbers. It never derives, sums, or
 * re-smoothes income. The prompt explicitly forbids recalculation.
 *
 * EXPENSE SOURCE
 * --------------
 * Expenses come from planned amounts (budgets + fixed recurring items), not
 * actual spending — this is the plan/review context: "you budgeted $X, here
 * is how you are tracking." This is intentionally different from income, which
 * uses the actual ledger for the month.
 */

import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { anthropic } from '@/lib/anthropic';
import { assembleCalculatedBudget, dedupeSinkingFunds } from '@/lib/planHelpers';
import { computeMonthTotals } from '@/lib/dashboardHelpers';

const SEED_CATEGORIES = [
  'Housing', 'Transportation', 'Restaurants', 'Groceries & Pharmacy',
  'Utilities & Subscriptions', 'Childcare', 'Shopping',
  'Health & Personal', 'Installments', 'Unexpected',
] as const;

type Category = { name: string; budgeted: number; type: string };

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Return YYYY-MM-DD for the first day of the given month (0-indexed month). */
function firstOfMonth(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-01`;
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

    // ── Current calendar month boundaries ───────────────────────────────────
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    const monthStart = firstOfMonth(year, month);
    const monthEnd = firstOfMonth(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1);

    // ── Read live data ───────────────────────────────────────────────────────
    //
    // Income: transactions for this month (ledger, same as Expenses page).
    //   DO NOT read from recurring_items for income — see module comment.
    //
    // Expenses: planned amounts from budgets + fixed recurring items.

    const [incomeTxResult, acctResult, recurringExpResult, budgetsResult, sfResult] = await Promise.all([
      supabase
        .from('transactions')
        .select('amount, type, description, account_id')
        .eq('household_id', householdId)
        .eq('type', 'income')
        .gte('date', monthStart)
        .lt('date', monthEnd),

      supabase
        .from('accounts')
        .select('id, type')
        .eq('household_id', householdId),

      supabase
        .from('recurring_items')
        .select('description, amount, type, cadence')
        .eq('household_id', householdId)
        .eq('type', 'expense')
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

    const incomeTxns = incomeTxResult.data ?? [];
    const accounts = acctResult.data ?? [];
    const fixedRecurringExpenses = recurringExpResult.data ?? [];
    const budgetRows = budgetsResult.data ?? [];
    const sinkingFunds = sfResult.data ?? [];

    // ── Income: ledger total (same function as Expenses page) ───────────────
    const { totalIncome: incomeTotal } = computeMonthTotals(
      incomeTxns.map((tx) => ({
        amount: Number(tx.amount),
        type: tx.type,
        account_id: tx.account_id,
      })),
      accounts,
    );

    // Aggregate per-source for AI context (Lineu: $8,247 in July, not 3 × $2,749 lines)
    const incomeBySource = new Map<string, number>();
    for (const tx of incomeTxns) {
      const label = tx.description ?? 'Income';
      incomeBySource.set(label, round((incomeBySource.get(label) ?? 0) + Number(tx.amount)));
    }
    const incomeLines = Array.from(incomeBySource.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);

    // ── Expenses: planned (budgets + fixed recurring items) ─────────────────
    const fixedExpenseLines = fixedRecurringExpenses.map((r) => ({
      label: r.description,
      amount: round(Number(r.amount)),
    }));

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
Income lines (actual ${monthStart.slice(0, 7)} ledger): ${JSON.stringify(incomeLines)}
Expense lines (planned budget): ${JSON.stringify(allExpenseLines)}
No goals or sinking funds provided — suggest based on expense labels and typical Canadian annual costs.`;

    // ── Generate plan (AI interprets pre-computed verified numbers only) ────
    //
    // The numbers in aiContext are VERIFIED by code. The AI is explicitly told
    // not to change or recalculate them. It only classifies and interprets.

    const categoryList = SEED_CATEGORIES.join(', ');
    const planPrompt = `You are Phare, an AI financial coach for Canadian families. The numbers below are VERIFIED — computed in code from the family's ledger. Do not change or recalculate them.

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

    // ── Generate review (blocking) ───────────────────────────────────────────

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

    // ── Save conversation row ───────────────────────────────────────────────

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
