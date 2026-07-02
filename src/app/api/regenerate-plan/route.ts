/**
 * POST /api/regenerate-plan
 *
 * Re-runs the financial plan and review against the household's CURRENT live
 * data, then saves a new conversation row.
 *
 * SINGLE SOURCE OF TRUTH: transactions for the current calendar month
 * -------------------------------------------------------------------
 * Both income AND expenses come from the materialized transactions table via
 * a single computeMonthTotals() call — the identical function the Expenses
 * page uses.  Nothing is read from recurring_items or budgets for the
 * headline figures or the AI context.
 *
 * Why NOT recurring_items:
 *   recurring_items stores per-period amounts with real cadences.
 *   Summing r.amount without applying cadence gives one-of-each-source:
 *     income  →  $2,749 + $2,742 + $383 = $5,874  (should be $11,365)
 *     expense →  $1,200 bi-weekly mortgage counted once (should be $2,400+)
 *   Both bugs produce a wrong net that can flip surplus ↔ deficit.
 *
 * Why transactions:
 *   materializeRule() already ran at save time with the real cadence, so a
 *   bi-weekly item already has 2 or 3 rows in the month.  No frequency math
 *   is needed at read time — the correct count is in the DB.
 *
 * The AI receives pre-computed verified numbers. It is explicitly told not
 * to change or recalculate them. It only classifies and interprets.
 *
 * EXPENSE LINES for the AI context
 * ---------------------------------
 * Chequing expenses only — mirrors the computeMonthTotals rule that prevents
 * card/bridge double-counting.  This means card purchases appear as a single
 * bridge-payment line (e.g. "Visa payment: $1,847") rather than individual
 * merchant transactions.  The total remains correct; line granularity is a
 * known limitation acceptable for the review context.
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

    // ── Current calendar month boundaries ────────────────────────────────────
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    const monthStart = firstOfMonth(year, month);
    const monthEnd = firstOfMonth(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1);

    // ── Three queries — no recurring_items, no budgets for headline figures ──
    const [allTxResult, acctResult, sfResult] = await Promise.all([
      supabase
        .from('transactions')
        .select('amount, type, description, account_id')
        .eq('household_id', householdId)
        .gte('date', monthStart)
        .lt('date', monthEnd),

      supabase
        .from('accounts')
        .select('id, type')
        .eq('household_id', householdId),

      supabase
        .from('sinking_funds')
        .select('name, annual_amount, monthly_provision, due_month')
        .eq('household_id', householdId),
    ]);

    const allTxns = allTxResult.data ?? [];
    const accounts = acctResult.data ?? [];
    const sinkingFunds = sfResult.data ?? [];

    // ── One call for all four buckets (same function as Expenses page) ───────
    const { totalIncome: incomeTotal, totalExpenses: expenseTotal, totalSavings, netCashFlow } =
      computeMonthTotals(
        allTxns.map((tx) => ({
          amount: Number(tx.amount),
          type: tx.type,
          account_id: tx.account_id,
        })),
        accounts,
      );

    const chequingIds = new Set(
      accounts.filter((a) => a.type === 'chequing').map((a) => a.id),
    );

    // ── Income lines: aggregate by source for AI context ─────────────────────
    // (e.g. Lineu bi-weekly appears 3× in July → one aggregated line: $8,247)
    const incomeBySource = new Map<string, number>();
    for (const tx of allTxns) {
      if (tx.type === 'income') {
        const label = tx.description ?? 'Income';
        incomeBySource.set(label, round((incomeBySource.get(label) ?? 0) + Number(tx.amount)));
      }
    }
    const incomeLines = Array.from(incomeBySource.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);

    // ── Expense lines: chequing only, aggregate by description ───────────────
    // Mirrors computeMonthTotals — avoids card/bridge double-count.
    const expenseByLabel = new Map<string, number>();
    for (const tx of allTxns) {
      if (
        tx.type === 'expense' &&
        tx.account_id !== null &&
        chequingIds.has(tx.account_id)
      ) {
        const label = tx.description ?? 'Expense';
        expenseByLabel.set(label, round((expenseByLabel.get(label) ?? 0) + Number(tx.amount)));
      }
    }
    const expenseLines = Array.from(expenseByLabel.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);

    // ── Assemble calculated object ────────────────────────────────────────────
    const calculated = {
      income:   { detected: incomeLines.length > 0,  lines: incomeLines,  total: incomeTotal  },
      expenses: { detected: expenseLines.length > 0, lines: expenseLines, total: expenseTotal },
      netCashFlow,
      excludedLines: [],
      confidence: 'high',
    };

    const monthlyBudget = assembleCalculatedBudget(calculated);

    const currentMonthLabel = monthStart.slice(0, 7); // YYYY-MM
    const aiContext =
      `Net cash flow: $${netCashFlow}/month ` +
      `(income $${incomeTotal}, expenses $${expenseTotal}, savings $${totalSavings})\n` +
      `Accounting model: net = income − expenses − savings (savings = actual transfers to goal accounts)\n` +
      `All figures are ACTUAL ${currentMonthLabel} ledger — computed from materialized transactions, ` +
      `NOT from planned budgets or per-period recurring amounts.\n` +
      `Income lines: ${JSON.stringify(incomeLines)}\n` +
      `Expense lines (chequing, avoids card double-count): ${JSON.stringify(expenseLines)}\n` +
      `No goals provided — suggest based on expense labels and typical Canadian annual costs.`;

    // ── Generate plan (AI interprets verified numbers only) ──────────────────
    const categoryList = SEED_CATEGORIES.join(', ');
    const planPrompt =
      `You are Phare, an AI financial coach for Canadian families. The numbers below are VERIFIED — ` +
      `computed in code from the family's ledger. Do not change or recalculate them.\n\n` +
      `${aiContext}\n\n` +
      `Write ALL text in ${lang}.\n\n` +
      `Return ONLY valid JSON:\n` +
      `{"sinkingFunds":[{"name":"","annualAmount":0,"monthlyProvision":0,"dueMonth":""}],"lineClassifications":[{"label":"","category":"","isFixed":true}],"goals":[{"name":"","targetAmount":0,"monthlyContribution":0,"onTrack":true,"estimatedDate":""}],"debtPayoff":{"description":"","targetDate":"","monthlyPayment":0},"topRecommendation":""}\n\n` +
      `Rules:\n` +
      `- All goal names, descriptions, and topRecommendation text in ${lang}.\n` +
      `- lineClassifications: for EACH expense line label provided, return an object with:\n` +
      `  - "label": the exact expense line label as given\n` +
      `  - "category": which ONE of these fits best: ${categoryList}. Use the English category name exactly as written here.\n` +
      `  - "isFixed": true if it is a fixed recurring bill paid every month; false if variable day-to-day spending.\n` +
      `- Classify income lines too: category "Income", isFixed true.\n` +
      `- Suggest 3-6 sinking funds for likely Canadian annual expenses inferred from the expense labels.\n` +
      `- goals: suggest 2-3 sensible goals based on their situation (emergency fund of 3 months expenses, RESP if children evident, debt payoff if debt evident).\n` +
      `- Canadian context: RRSP, RESP, TFSA, CESG.\n` +
      `- If net cash flow is negative, topRecommendation must address that first.\n` +
      `- If no debt is evident, set debtPayoff to null.\n` +
      `- topRecommendation: one specific sentence with a dollar amount.`;

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

    // ── Generate review (blocking) ────────────────────────────────────────────
    const reviewPrompt =
      `You are Phare, an AI financial coach for Canadian families. Write this family's monthly review in ${lang}.\n\n` +
      `Their plan:\n${JSON.stringify(plan)}\n\n` +
      `Write four paragraphs maximum. Specific numbers. One clear recommendation. Plain language. ` +
      `It must feel like a letter from a trusted financial advisor, not a report.\n\n` +
      `Good tone: "June was a solid month overall. You stayed within budget in four of five categories..."\n` +
      `Bad tone: "Based on a comprehensive analysis of your financial data..."\n\n` +
      `Start with what is going well, then what to watch, then the one thing to do this month. ` +
      `Write ONLY the review text, no preamble, no headings.`;

    const reviewMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      messages: [{ role: 'user', content: reviewPrompt }],
    });

    const reviewText = reviewMessage.content[0].type === 'text' ? reviewMessage.content[0].text : '';

    // ── Save conversation row ─────────────────────────────────────────────────
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
