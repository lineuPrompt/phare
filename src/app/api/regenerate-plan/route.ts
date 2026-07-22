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
import { computeMonthTotals, computeGoalBalance, GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { evaluateGoals, isDebtGoalName, computeDebtPayoff, GoalResult, DebtPayoffResult } from '@/lib/goalHelpers';
import { detectWindfalls } from '@/lib/reviewContextHelpers';
import { businessToday, businessMonth } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

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

    // ── Current calendar month boundaries (household timezone, not the
    // server's UTC clock) ────────────────────────────────────────────────────
    const timezone = await getHouseholdTimezone(supabase, householdId);
    const [ty, tmo] = businessMonth(timezone).split('-').map(Number);
    const year = ty;
    const month = tmo - 1; // 0-indexed, matching firstOfMonth's contract
    const monthStart = firstOfMonth(year, month);
    const monthEnd = firstOfMonth(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1);

    // ── recurring_item_id is now selected too (headline figures still come
    // entirely from computeMonthTotals over these same rows) — needed to
    // count each recurring item's occurrences this month for windfall
    // detection below (Part B.4). ──
    const [allTxResult, acctResult, sfResult] = await Promise.all([
      supabase
        .from('transactions')
        .select('amount, type, description, account_id, recurring_item_id')
        .eq('household_id', householdId)
        .gte('date', monthStart)
        .lt('date', monthEnd),

      supabase
        .from('accounts')
        .select('id, name, type, goal_target, goal_target_date, is_sinking_fund')
        .eq('household_id', householdId),

      supabase
        .from('sinking_funds')
        .select('name, annual_amount, monthly_provision, due_month, linked_account_id')
        .eq('household_id', householdId)
        .eq('active', true),
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

    // ── Goals & debt payoff: code-computed from REAL goal accounts, never
    // AI-invented. Every account with a goal_target is a real, user-set goal
    // (created via onboarding or the Goals page) — mirrors api/plan/route.ts's
    // template-source handling exactly, just reading accounts instead of a
    // parsed sheet. Requires full (all-time) transaction history per goal
    // account, not just this month's window, so computeGoalBalance sees the
    // real running balance (same fetch dashboard/route.ts uses). ──────────
    const goalAccountList = accounts.filter(
      (a) => (GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type) && a.goal_target != null && !a.is_sinking_fund
    );
    // Sinking-fund accounts are fetched into the same tx pull too (Build 4
    // Part 2, 2026-07-21) — they never carry a goal_target, so goalAccountList
    // naturally excludes them, but their own balance still needs computing
    // for the sinkingFunds section below.
    const fundAccountIds = accounts.filter((a) => a.is_sinking_fund).map((a) => a.id);
    const goalIds = [...goalAccountList.map((a) => a.id), ...fundAccountIds];
    let goalTxData: { amount: number | string; type: string; account_id: string | null; date?: string }[] = [];
    if (goalIds.length > 0) {
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, account_id, date')
        .eq('household_id', householdId)
        .in('account_id', goalIds);
      goalTxData = data ?? [];
    }
    const today = businessToday(timezone);
    const rawGoals = goalAccountList.map((a) => ({
      name: a.name,
      targetAmount: Number(a.goal_target),
      // Today-cutoff balance: recurring transfers materialize future-dated
      // rows ahead of time (Phase 2) — a goal/debt's real progress must
      // never count a payment that hasn't happened yet.
      savedSoFar: computeGoalBalance(goalTxData, a.id, today),
      targetDate: a.goal_target_date ?? null,
      isDebt: a.type === 'debt',
    }));
    // Debt detection: an explicitly-typed debt ACCOUNT (Build 4 Phase 3)
    // always wins — isDebtGoalName's keyword match is retired the moment a
    // real debt type exists, and remains only as a fallback for goals that
    // predate this feature or came from a typeless template import (where no
    // account type is available yet — see api/plan/route.ts, unchanged).
    const explicitDebt = rawGoals.find((g) => g.isDebt);
    const debtGoalLine = explicitDebt ?? rawGoals.find((g) => isDebtGoalName(g.name));
    const nonDebtGoals = rawGoals.filter((g) => g !== debtGoalLine);
    const computedDebtPayoff: DebtPayoffResult | null = computeDebtPayoff(debtGoalLine, today);
    const computedGoals: GoalResult[] = evaluateGoals(nonDebtGoals, netCashFlow, today);

    // ── Recurring contributions & debt payments already committed ───────────
    // Fetched so the AI can narrate them as already-netted-out capacity
    // ("your $500/mo RRSP contribution is already counted") rather than
    // treating net cash flow as fully discretionary. Code-computed list,
    // never a number the AI invents — it only narrates what's here.
    const { data: recurringTransferRows } = await supabase
      .from('recurring_items')
      .select('amount, cadence, accounts:accounts!recurring_items_destination_account_id_fkey(name, type)')
      .eq('household_id', householdId)
      .eq('type', 'transfer')
      .eq('active', true);
    const committedTransfers = ((recurringTransferRows ?? []) as unknown as { amount: number | string; cadence: string; accounts: { name: string; type: string } | null }[])
      .map((r) => ({
        destination: r.accounts?.name ?? 'goal',
        isDebtPayment: r.accounts?.type === 'debt',
        amount: Number(r.amount),
        cadence: r.cadence,
      }));

    // ── Windfall awareness (Part B.4) ────────────────────────────────────────
    // An extra biweekly paycheque or a third mortgage payment this month is a
    // real, code-detected fact — passed to the review as something it MUST
    // acknowledge and MUST NOT present as a new run-rate ("July has three of
    // Lineu's paycheques — $2,749 extra that won't repeat in August").
    const { data: activeRecurringItems } = await supabase
      .from('recurring_items')
      .select('id, description, cadence, type')
      .eq('household_id', householdId)
      .in('type', ['income', 'expense'])
      .eq('active', true);
    const windfalls = detectWindfalls(
      allTxns.map((tx) => ({ recurring_item_id: tx.recurring_item_id ?? null, amount: tx.amount })),
      (activeRecurringItems ?? []) as { id: string; description: string; cadence: string; type: string }[]
    );

    // ── Named review period (Part B.5) ───────────────────────────────────────
    // The AI must never guess or default to a different month than the one
    // actually reviewed — it's a computed input, not something to infer.
    const reviewMonthName = new Date(monthStart + 'T00:00:00').toLocaleDateString(
      locale === 'fr' ? 'fr-CA' : 'en-CA',
      { month: 'long', year: 'numeric' }
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
      `The reviewed period is ${reviewMonthName} (${currentMonthLabel}) — refer to it by this exact name, never a different month.\n` +
      `Net cash flow: $${netCashFlow}/month ` +
      `(income $${incomeTotal}, expenses $${expenseTotal}, savings $${totalSavings})\n` +
      `Accounting model: net = income − expenses − savings (savings = actual transfers to goal accounts)\n` +
      `All figures are ACTUAL ${currentMonthLabel} ledger — computed from materialized transactions, ` +
      `NOT from planned budgets or per-period recurring amounts.\n` +
      `Income lines: ${JSON.stringify(incomeLines)}\n` +
      `Expense lines (chequing, avoids card double-count): ${JSON.stringify(expenseLines)}\n` +
      `Their sinking funds (already set up, or none): ${JSON.stringify(sinkingFunds)}\n` +
      `Their goals — ALREADY verified, do not recompute or contradict these numbers, just narrate them naturally where relevant: ${JSON.stringify(computedGoals)}\n` +
      `Their debt payoff — ALREADY verified (null means no debt evident or nothing computable), do not recompute or contradict: ${JSON.stringify(computedDebtPayoff)}\n` +
      `Their recurring contributions and debt payments (or none) — these are already deducted inside the ` +
      `savings figure and net cash flow above, NOT extra discretionary room: ${JSON.stringify(committedTransfers)}\n` +
      `Windfalls this month (or none) — a recurring item that landed MORE times than its usual cadence this ` +
      `specific month (e.g. a third biweekly paycheque instead of two). Each one MUST be acknowledged as a ` +
      `one-time timing event, MUST NOT be treated as a new ongoing run-rate: ${JSON.stringify(windfalls)}`;

    // ── Generate plan (AI interprets verified numbers only) ──────────────────
    // The AI may NEVER instantiate structured objects here either — same hard
    // gate as api/plan/route.ts. Sinking funds come from the real sinking_funds
    // table (or none); goals/debtPayoff come from real goal accounts via
    // evaluateGoals()/computeDebtPayoff() (or none). This feeds the ongoing
    // monthly review — the single most important retention surface — so it
    // must be constitutionally incapable of inventing a fund, goal, or debt
    // plan the family never set up.
    const categoryList = SEED_CATEGORIES.join(', ');
    const planPrompt =
      `You are Phare, an AI financial coach for Canadian families. The numbers below are VERIFIED — ` +
      `calculated from the family's ledger. Do not change or recalculate them.\n\n` +
      `${aiContext}\n\n` +
      `Write ALL text in ${lang}.\n\n` +
      `Return ONLY valid JSON:\n` +
      `{"lineClassifications":[{"label":"","category":"","isFixed":true}],"topRecommendation":""}\n\n` +
      `Rules:\n` +
      `- All descriptions and topRecommendation text in ${lang}.\n` +
      `- lineClassifications: for EACH expense line label provided, return an object with:\n` +
      `  - "label": the exact expense line label as given\n` +
      `  - "category": which ONE of these fits best: ${categoryList}. Use the English category name exactly as written here.\n` +
      `  - "isFixed": true if it is a fixed recurring bill paid every month; false if variable day-to-day spending.\n` +
      `- Classify income lines too: category "Income", isFixed true.\n` +
      `- Do NOT output any sinking funds, goals, or debt payoff as structured data — there is no field for them in the JSON above. If you want to suggest one, put it in topRecommendation as a suggestion phrased as a suggestion ("Consider…"), never as a fund/goal/debt-plan they already have and never with a monthly amount presented as theirs.\n` +
      `- Their goals and debt payoff (if any) are already evaluated (contribution, on-track verdict, and dates are all real, verified numbers) — do not invent or restate any of those figures anywhere; if you reference one in topRecommendation, use the exact numbers given.\n` +
      `- Their recurring contributions and debt payments (if any) are already subtracted from the net cash flow figure above — if you mention one, say it's already accounted for (e.g. "your $500/mo RRSP contribution is already counted"), never present it as new discretionary room and never double-count it against a separate suggestion.\n` +
      `- Vocabulary: never write "code", "computed in code", or similar internal/technical phrasing — a reader must never see the word "code" at all. An estimated date or figure should read as a plain estimate (e.g. "estimated: March 2027"), never "code-estimated". Never call a figure "budgeted" unless the family actually set that budget themselves — a computed or projected amount (including a card/bridge payment total) should read as "expected", not "budgeted".\n` +
      `- Canadian context: RRSP, RESP, TFSA, CESG.\n` +
      `- If net cash flow is negative, topRecommendation must address that first.\n` +
      `- topRecommendation: one specific sentence with a dollar amount.`;

    const planMessage = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      messages: [{ role: 'user', content: planPrompt }],
    });

    const planText = planMessage.content[0].type === 'text' ? planMessage.content[0].text : '';
    const aiPart = JSON.parse(planText.replace(/```json|```/g, '').trim());

    // Sinking funds are DB-derived (real rows) or empty — never AI-invented.
    // aiPart is not consulted for them. Every row now shares ONE cash buffer
    // (Build 4 Part A, 2026-07-21 revision) — no family runs seven separate
    // sinking accounts — so the per-fund entries stay display-only
    // (name/amounts/due month) and the one real fundedAlready signal lives
    // on sinkingFundBuffer below, computed once from whichever account any
    // row is linked to (they're all the same account, by construction).
    const finalSinkingFunds = sinkingFunds.map((sf) => ({
      name: sf.name,
      annualAmount: Number(sf.annual_amount),
      monthlyProvision: Number(sf.monthly_provision),
      dueMonth: sf.due_month ?? '',
    }));
    const bufferAccountId = sinkingFunds.find((sf) => sf.linked_account_id)?.linked_account_id ?? null;
    const bufferBalance = bufferAccountId
      ? computeGoalBalance(goalTxData, bufferAccountId, today)
      : 0;
    const sinkingFundBuffer = {
      fundedAlready: bufferBalance > 0,
      totalMonthlyProvision: Math.round(
        sinkingFunds.reduce((sum, sf) => sum + Number(sf.monthly_provision ?? 0), 0) * 100
      ) / 100,
    };

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
      reviewMonth: reviewMonthName,
      monthlyBudget: { ...monthlyBudget, categories: classifiedCategories },
      seedCategories: SEED_CATEGORIES,
      sinkingFunds: finalSinkingFunds,
      sinkingFundBuffer,
      // Code-computed from real goal accounts — never AI-emitted.
      debtPayoff: computedDebtPayoff,
      goals: computedGoals,
      windfalls,
      topRecommendation: aiPart.topRecommendation ?? '',
    };

    // ── Generate review (blocking) ────────────────────────────────────────────
    // Part B hardening (2026-07-19), against four real failures in the
    // founder's July 17 review: a wrong month name, a windfall paycheque
    // narrated as a new run-rate, an on-track claim beyond what evaluateGoals
    // actually verified, and prose arithmetic that didn't match its own parts.
    const reviewPrompt =
      `You are Phare, an AI financial coach for Canadian families. Write this family's monthly review in ${lang}.\n\n` +
      `Their plan:\n${JSON.stringify(plan)}\n\n` +
      `Write four paragraphs maximum. Specific numbers. One clear recommendation. Plain language. ` +
      `It must feel like a letter from a trusted financial advisor, not a report.\n\n` +
      `Good tone: "${reviewMonthName} was a solid month overall. You stayed within budget in four of five categories..."\n` +
      `Bad tone: "Based on a comprehensive analysis of your financial data..."\n\n` +
      `Start with what is going well, then what to watch, then the one thing to do this month. ` +
      `Write ONLY the review text, no preamble, no headings.\n\n` +
      `Hard rules — every one of these caused a real, published mistake before, do not repeat any of them:\n` +
      `- The reviewed month is "reviewMonth" above: ${reviewMonthName}. Refer to it by exactly this name. ` +
      `Never name a different month (not last month, not a guess, not an example from your own training) — ` +
      `this field is the only source of truth for which period you are reviewing.\n` +
      `- NO ARITHMETIC: every number in "plan" is already fully computed. You may only restate a figure exactly ` +
      `as given — you may NOT add, subtract, multiply, divide, average, or otherwise derive any number that is ` +
      `not already present as a single value above. If no single given figure says what you want to say, don't ` +
      `say it with a number.\n` +
      `- ON-TRACK CLAIMS: for any goal or debt, you may state its status only by directly restating what "goals"/` +
      `"debtPayoff" already say (onTrack, fundedAlready, pastDue, monthlyContribution, estimatedDate) — never ` +
      `assert or imply "on track", "behind", or "funded" beyond exactly what those fields already say for that ` +
      `specific goal.\n` +
      `- ZERO-BALANCE GOALS: for any goal whose "savedSoFar" is 0 and "fundedAlready" is false, write about it as ` +
      `forward-looking — e.g. "once your $X/month contribution begins" — never as if saving is already underway, ` +
      `even when "onTrack" is true (onTrack only means the required contribution fits their capacity, not that ` +
      `any money has moved yet).\n` +
      `- SINKING FUNDS: every entry in "sinkingFunds" shares ONE cash buffer — "sinkingFundBuffer.fundedAlready" is ` +
      `the single real signal for ALL of them (never treat one fund as funded and another as not; there is only one ` +
      `account). When fundedAlready is false — meaning the buffer hasn't been started yet — describe each fund as a ` +
      `plan or recommendation only: "your plan sets aside $X/month for {name}" or "recommended: $X/month toward ` +
      `{name} so the {month} bill doesn't catch you off guard." NEVER say "you're setting aside $X/month" or ` +
      `"you're saving $X/month" for any fund unless sinkingFundBuffer.fundedAlready is true. You may mention ` +
      `"sinkingFundBuffer.totalMonthlyProvision" as the combined monthly amount across every fund, but never sum ` +
      `the individual funds yourself — that figure is already given.\n` +
      `- WINDFALLS: if "windfalls" is non-empty, you MUST explicitly acknowledge each one by name and amount, ` +
      `framed as a one-time timing event that will NOT repeat next month (e.g. "${reviewMonthName} included a ` +
      `third biweekly paycheque — $X extra that won't repeat next month") — never described as a new normal ` +
      `income/expense level going forward.\n` +
      `- VOCABULARY: never write "code", "computed in code", or similar internal/technical phrasing anywhere — ` +
      `the reader must never see the word "code". An estimated date or figure reads as a plain estimate (e.g. ` +
      `"estimated: March 2027"), never "code-estimated" or "code-computed". A projected or computed amount ` +
      `(including a card/bridge payment total) reads as "expected", never "budgeted" — reserve "budgeted" only ` +
      `for a figure the family actually set as a budget themselves.`;

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
