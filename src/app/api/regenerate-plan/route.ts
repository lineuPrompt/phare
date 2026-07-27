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
import { evaluateGoals, isDebtGoalName, computeDebtPayoff, addMonthsToMonth, monthsBetween, GoalResult, DebtPayoffResult } from '@/lib/goalHelpers';
import { detectWindfalls } from '@/lib/reviewContextHelpers';
import { categoryActualsForCard } from '@/lib/envelopeHelpers';
import { enforceDebtFigureInTopRecommendation, enforceBorrowedCashFraming, DEBT_PAYMENT_PLACEHOLDER } from '@/lib/topRecommendationHelpers';
import {
  computeSinkingFundUrgency,
  rankFundingNeeds,
  computeTypicalSurplus,
  computeInsufficientHistory,
  computeOverTargetCategories,
  selectTopOverTargetCategory,
  computeFreedCapacityEvents,
  groupInstallmentSeries,
  computeStartingContribution,
  coachingFallbackApplies,
  findUnsanctionedSourcingMention,
  buildFallbackReviewText,
  FundingNeed,
} from '@/lib/coachingHelpers';
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
    const currentMonthLabel = monthStart.slice(0, 7); // YYYY-MM

    // ── recurring_item_id is now selected too (headline figures still come
    // entirely from computeMonthTotals over these same rows) — needed to
    // count each recurring item's occurrences this month for windfall
    // detection below (Part B.4). category_id/is_bridge/date are additive —
    // needed by the Coaching Layer's over-target-category sourcing below,
    // never used by the pre-existing headline/windfall/line-aggregation
    // logic, which still relies on the query's own monthStart/monthEnd
    // range exactly as before. ──
    const [allTxResult, acctResult, sfResult, historyResult] = await Promise.all([
      supabase
        .from('transactions')
        .select('id, amount, type, description, account_id, recurring_item_id, transfer_peer_id, category_id, is_bridge, date')
        .eq('household_id', householdId)
        .gte('date', monthStart)
        .lt('date', monthEnd),

      supabase
        .from('accounts')
        .select('id, name, type, goal_target, goal_target_date, is_sinking_fund')
        .eq('household_id', householdId),

      supabase
        .from('sinking_funds')
        .select('name, annual_amount, monthly_provision, due_month, due_day, linked_account_id')
        .eq('household_id', householdId)
        .eq('active', true),

      // Coaching Layer (2026-07-25): one wide window covering the 3 complete
      // calendar months before this one (typical-surplus history) through 12
      // months ahead (real materialized future rows — same horizon
      // convention as the dashboard's month nav — long enough to find any
      // already-materialized installment series' real final row). Kept as
      // its own query rather than widening the query above so the existing
      // headline/windfall/line-aggregation logic above is untouched — it
      // still sees exactly the current month, nothing more.
      supabase
        .from('transactions')
        .select('amount, type, account_id, date, recurring_item_id, installment_label, recurrence_id, description')
        .eq('household_id', householdId)
        .gte('date', `${addMonthsToMonth(monthStart.slice(0, 7), -3)}-01`)
        .lt('date', `${addMonthsToMonth(monthStart.slice(0, 7), 12)}-01`),
    ]);

    const allTxns = allTxResult.data ?? [];
    const accounts = acctResult.data ?? [];
    const sinkingFunds = sfResult.data ?? [];
    const historyRows = historyResult.data ?? [];

    // ── One call for all buckets (same function as Expenses page) ───────────
    const { totalIncome: incomeTotal, totalExpenses: expenseTotal, totalSavings, totalDebtPayments, totalBorrowed, netCashFlow } =
      computeMonthTotals(
        allTxns.map((tx) => ({
          id: tx.id,
          amount: Number(tx.amount),
          type: tx.type,
          account_id: tx.account_id,
          transfer_peer_id: tx.transfer_peer_id ?? null,
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

    // ── The Coaching Layer ────────────────────────────────────────────────────
    // Every figure below is code-computed (coachingHelpers.ts) and only ever
    // narrated by the review prompt — the AI is never asked to choose a
    // category or a priority. See coachingHelpers.ts for why a category with
    // no real overspend cannot reach this object at all, which is what makes
    // fabrication structurally impossible rather than merely discouraged.

    // 1. Prioritization: sinking-fund allocations + non-debt goals share one
    // ranked list. Debts stay OUT of it — a debt's monthly payment is either
    // already a committedTransfer above (already netted out of netCashFlow)
    // or not set up yet, in which case the debt card's own verdict already
    // surfaces that; folding it in here would pose a false choice between a
    // bill already being paid and a need that isn't.
    const fundingNeeds: FundingNeed[] = [
      ...sinkingFunds
        .filter((sf) => Number(sf.monthly_provision ?? 0) > 0)
        .map((sf) => ({
          kind: 'sinkingFundAllocation' as const,
          name: sf.name,
          monthlyProvision: Number(sf.monthly_provision),
          monthsUntilDue: computeSinkingFundUrgency(
            { dueMonth: sf.due_month ?? null, dueDay: sf.due_day ?? null },
            today
          ).monthsUntilDue,
          pastDue: false as const,
        })),
      ...computedGoals
        .filter((g) => !g.fundedAlready)
        .map((g) => {
          const amountRemaining = Math.max(0, g.targetAmount - g.savedSoFar);
          return {
            kind: 'goal' as const,
            name: g.name,
            // For an on-track/behind goal this is the real required $/month
            // (requiredMonthlyContribution). A past-due goal has no valid
            // $/month against an already-passed target date — amountRemaining
            // substitutes purely as a ranking/tie-break magnitude here; the
            // review is only ever given amountRemaining/targetDate/pastDue
            // for a past-due item, never told to narrate this as a literal
            // monthly figure.
            monthlyContribution: g.pastDue ? amountRemaining : g.monthlyContribution,
            monthsToTarget: g.hasTargetDate && g.targetDate ? monthsBetween(today, g.targetDate) : null,
            pastDue: g.pastDue,
            amountRemaining,
          };
        }),
    ];
    const rankedNeeds = rankFundingNeeds(fundingNeeds);
    const topNeed = rankedNeeds[0] ?? null;

    // 2a. Typical surplus: the 3 complete calendar months before this one,
    // windfalls netted back out so a one-time extra paycheque never inflates
    // what looks like ongoing room. historyRows' fixed 3-month/12-month-ahead
    // window (fetched above) covers this.
    const priorMonths = [1, 2, 3].map((n) => addMonthsToMonth(currentMonthLabel, -n));
    const monthlyFigures = priorMonths.map((m) => {
      const mStart = `${m}-01`;
      const mEnd = `${addMonthsToMonth(m, 1)}-01`;
      const monthRows = historyRows.filter((r) => r.date >= mStart && r.date < mEnd);
      const monthTotals = computeMonthTotals(
        monthRows.map((r) => ({ amount: Number(r.amount), type: r.type, account_id: r.account_id })),
        accounts
      );
      const monthWindfalls = detectWindfalls(
        monthRows.map((r) => ({ recurring_item_id: r.recurring_item_id ?? null, amount: r.amount })),
        (activeRecurringItems ?? []) as { id: string; description: string; cadence: string; type: string }[]
      );
      const windfallExtra = monthWindfalls.reduce((sum, w) => sum + w.amount, 0);
      return { month: m, netCashFlow: monthTotals.netCashFlow, windfallExtra, hasRealData: monthRows.length > 0 };
    });
    const typicalSurplusResult = computeTypicalSurplus(monthlyFigures);
    const typicalSurplus = typicalSurplusResult?.typicalSurplus ?? null;
    // Fix 2 (2026-07-27): separate from fallbackApplies, which asks "is there
    // nothing anywhere to point to" — a household can have a real
    // sourceCategory/freedCapacityEvents AND still have most of its trailing
    // window be genuinely empty (e.g. recently onboarded). This lets the
    // review explain a conservative $0 honestly instead of staying silent.
    const insufficientHistory = computeInsufficientHistory(monthlyFigures);

    // 2b. Real over-target categories — card-envelope categories only (the
    // one place a family sets a real spending target today; there is no
    // chequing-side category target anywhere in the schema). Code selects AT
    // MOST ONE candidate (the largest overspend) — the AI is never given the
    // full list and never chooses; it only narrates the one already chosen.
    const cardAccounts = accounts.filter((a) => a.type === 'credit_card');
    let overTargetCategories: ReturnType<typeof computeOverTargetCategories> = [];
    if (cardAccounts.length > 0) {
      const cardIds = cardAccounts.map((a) => a.id);
      const { data: envelopeItemRows } = await supabase
        .from('card_envelope_items')
        .select('account_id, category_id, monthly_amount, categories(name, name_fr)')
        .eq('household_id', householdId)
        .in('account_id', cardIds)
        .eq('month', monthStart);

      const categoryFigures: { categoryName: string; target: number; actual: number }[] = [];
      for (const item of (envelopeItemRows ?? []) as unknown as { account_id: string; category_id: string; monthly_amount: number; categories: { name: string; name_fr: string | null } | null }[]) {
        const actualsMap = categoryActualsForCard(
          allTxns.map((t) => ({
            account_id: t.account_id as string,
            amount: t.amount,
            category_id: (t as { category_id?: string | null }).category_id ?? null,
            type: t.type,
            date: (t as { date?: string }).date ?? '',
            is_bridge: (t as { is_bridge?: boolean | null }).is_bridge ?? false,
          })),
          item.account_id,
          currentMonthLabel
        );
        categoryFigures.push({
          categoryName: item.categories?.name ?? '?',
          target: Number(item.monthly_amount),
          actual: actualsMap.get(item.category_id) ?? 0,
        });
      }
      overTargetCategories = computeOverTargetCategories(categoryFigures);
    }
    const sourceCategory = selectTopOverTargetCategory(overTargetCategories);

    // 2c. Freed-capacity events: the debt's own already-computed payoff date
    // (zero new math), plus any real installment series whose final,
    // already-materialized row is still in the future (each row carries its
    // own real date — no parsing of the cosmetic "N/Total" label needed,
    // only that it's non-null so a plain monthly-repeat row is excluded).
    const installmentSeries = groupInstallmentSeries(
      historyRows.map((r) => ({
        recurrence_id: (r as { recurrence_id?: string | null }).recurrence_id ?? null,
        installment_label: (r as { installment_label?: string | null }).installment_label ?? null,
        description: r.description ?? null,
        amount: r.amount,
        date: r.date,
      }))
    );
    const endingInstallments = installmentSeries.filter((s) => s.lastDate > today);
    const freedCapacityEvents = computeFreedCapacityEvents(computedDebtPayoff, endingInstallments);

    // 3. Ramping: never more than the top-ranked need requires, never more
    // than typical surplus (already net of committed transfers and
    // windfalls — genuinely uncommitted room). No cushion (founder decision,
    // 2026-07-25) — typicalSurplus already being an average is the margin.
    const startingContribution = computeStartingContribution(topNeed, typicalSurplus);

    // Meaning constraint, not fixed copy (founder decision, 2026-07-25): the
    // review prompt below requires the model to state plainly, in its own
    // words, that there's no clear extra room and to start small/revisit
    // later whenever this is true — never a vaguer instruction, never an
    // invented source.
    const fallbackApplies = coachingFallbackApplies({ typicalSurplus, sourceCategory, freedCapacityEvents });

    const coaching = {
      rankedNeeds,
      typicalSurplus,
      monthsOfHistoryUsed: typicalSurplusResult?.monthsUsed ?? 0,
      sourceCategory,
      freedCapacityEvents,
      startingContribution,
      fallbackApplies,
      insufficientHistory,
      // Fix (2026-07-28): borrowed cash is never real capacity — the same
      // binding contract typicalSurplus/startingContribution already honor
      // (netCashFlow, which both derive from, structurally excludes it).
      // Placed here rather than top-level "plan" so the constraint sits next
      // to the figures it constrains. reviewText previously had NO visibility
      // into this at all (plan never carried it) — see the COACHING rule
      // below for what the model may/may not say about it.
      totalBorrowed,
    };

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

    const aiContext =
      `The reviewed period is ${reviewMonthName} (${currentMonthLabel}) — refer to it by this exact name, never a different month.\n` +
      `Net cash flow: $${netCashFlow}/month ` +
      `(income $${incomeTotal}, expenses $${expenseTotal}, savings $${totalSavings}, debt payments $${totalDebtPayments})\n` +
      `Accounting model: net = income − expenses − savings − debt payments (savings = transfers to a ` +
      `savings/TFSA/RRSP/sinking-fund account; debt payments = transfers to a debt account — paying down a ` +
      `credit line is not saving, keep the two separate in the narration)\n` +
      (totalBorrowed > 0
        ? `Borrowed this month: $${totalBorrowed}, drawn from a credit line. This is debt, NOT income and NOT ` +
          `savings — it is already excluded from every figure above. Never describe this month as having more ` +
          `income, savings, or surplus because of it; if you mention the family's cash position, disclose that ` +
          `part of it was borrowed.\n`
        : '') +
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
      `- Their goals (if any) are already evaluated (contribution, on-track verdict, and dates are all real, verified numbers) — do not invent or restate any of those figures anywhere.\n` +
      `- DEBT PAYOFF: if topRecommendation mentions the debt's own required monthly payment amount, you MUST write the literal placeholder ${DEBT_PAYMENT_PLACEHOLDER} in its place — never type a dollar figure for it yourself, under any circumstance, in any language or currency format. You may still describe timing/urgency around it in your own words (e.g. "with the credit line's ${DEBT_PAYMENT_PLACEHOLDER}/month payment, this month's extra room could go toward it").\n` +
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
      // The Coaching Layer — entirely code-computed (coachingHelpers.ts),
      // same discipline as goals/debtPayoff above: the AI only narrates
      // this, it never reorders rankedNeeds, never picks a different
      // sourceCategory, never invents a freedCapacityEvent or a starting
      // amount above startingContribution.
      coaching,
      // FIX 1 (2026-07-27): topRecommendation is planPrompt's free text — the
      // debt's own monthly payment figure inside it is never trusted as
      // AI-authored digits. Either the model used the required placeholder
      // (substituted with the real, code-computed amount) or it didn't (in
      // which case the whole recommendation is replaced with a deterministic
      // one) — see topRecommendationHelpers.ts for the full mechanism and the
      // confirmed live failure this closes.
      // FIX 4 (2026-07-28): separately, never let a real credit-line draw get
      // labeled as surplus/extra/income — runs purely off totalBorrowed, not
      // gated on computedDebtPayoff/a debt-payoff card existing at all.
      topRecommendation: enforceBorrowedCashFraming(
        enforceDebtFigureInTopRecommendation(
          aiPart.topRecommendation ?? '',
          computedDebtPayoff,
          locale
        ),
        totalBorrowed,
        locale
      ),
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
      `the individual funds yourself — that figure is already given. "monthlyProvision"/"totalMonthlyProvision" are ` +
      `the plan's OWN established figures and may always be restated using the phrasing above regardless of ` +
      `"coaching.startingContribution" — that cap governs a different thing entirely: see COACHING below for ` +
      `exactly what it bounds.\n` +
      `- WINDFALLS: if "windfalls" is non-empty, you MUST explicitly acknowledge each one by name and amount, ` +
      `framed as a one-time timing event that will NOT repeat next month (e.g. "${reviewMonthName} included a ` +
      `third biweekly paycheque — $X extra that won't repeat next month") — never described as a new normal ` +
      `income/expense level going forward.\n` +
      `- VOCABULARY: never write "code", "computed in code", or similar internal/technical phrasing anywhere — ` +
      `the reader must never see the word "code". An estimated date or figure reads as a plain estimate (e.g. ` +
      `"estimated: March 2027"), never "code-estimated" or "code-computed". A projected or computed amount ` +
      `(including a card/bridge payment total) reads as "expected", never "budgeted" — reserve "budgeted" only ` +
      `for a figure the family actually set as a budget themselves.\n` +
      `- COACHING — WHERE THE MONEY COMES FROM: "coaching" is the ONLY source of any funding-priority or ` +
      `money-source suggestion. Its "rankedNeeds" is already in the correct priority order — restate that order, ` +
      `never re-rank it yourself and never suggest funding anything not in this list. SCOPE OF THE CAP: ` +
      `"coaching.startingContribution" bounds only a DISCRETIONARY "extra"/"additional" amount YOU might suggest ` +
      `directing toward a need ON TOP OF what the plan already calls for — it does NOT cap restating a sinking ` +
      `fund's own "monthlyProvision" or a goal's own "monthlyContribution" verbatim (those are the plan's existing, ` +
      `already-established figures, governed by the SINKING FUNDS and ON-TRACK CLAIMS rules above, not by this ` +
      `cap; e.g. "your plan calls for $300/month toward Property Tax" is always fine to state even when ` +
      `startingContribution is $0 — that number is not a new suggestion). What the cap DOES bound: ` +
      `"coaching.startingContribution" is the most you may ever propose applying as NEW, additional, on-top-of-` +
      `plan money — never recommend a larger discretionary figure than that. If "coaching.sourceCategory" ` +
      `is non-null, you may name ONLY that one category as a possible source (its exact target/actual/over figures, ` +
      `never any other category, never a target you were not given) — phrase it as an option the family can use if ` +
      `they choose, e.g. "restaurants ran $X against your own $Y target — that's one place it could come from," ` +
      `never a command like "cut back on X." If "coaching.sourceCategory" is null, do not name ANY category as a ` +
      `money source. If "coaching.freedCapacityEvents" is non-empty, you may describe growth only from those exact ` +
      `events (their own label/amount/freesOn) — e.g. "once X clears in {freesOn}, that $Y/month could go toward ` +
      `{need}" — never invent a percentage, a schedule, or a growth event not in this list. If ` +
      `"coaching.fallbackApplies" is true, you must state plainly, in your own natural words, that there is no ` +
      `clear extra room right now and that starting small / revisiting later is the move — never substitute a ` +
      `vaguer instruction like "look at your spending," and never name a category or event to fill the gap. If ` +
      `"coaching.insufficientHistory" is true, you may state plainly, in your own words, that a starting figure is ` +
      `conservative because there isn't a full trailing history to draw on yet (e.g. "this is a cautious starting ` +
      `point while we build a fuller picture of your typical months") — this is a DIFFERENT condition from ` +
      `fallbackApplies and can be true even when fallbackApplies is false and a real sourceCategory/` +
      `freedCapacityEvents exist; never treat the two as the same thing, and never invent a larger or different ` +
      `number to fill the gap either way — the honest explanation is the only thing that changes. BORROWED CASH: ` +
      `"coaching.totalBorrowed" is real money drawn from a credit line this month (0 means none) — it is NOT ` +
      `income, NOT savings, and NOT part of any surplus/capacity figure above (netCashFlow/typicalSurplus already ` +
      `exclude it entirely). If it is non-zero, you may disclose it honestly (e.g. "$X of this month's cash was ` +
      `borrowed from a credit line") but must NEVER describe it as surplus, extra, income, or savings, and must ` +
      `never add it into or imply it inflates any capacity figure you state. TONE: ` +
      `never write "cut", "cut back", "reduce your spending on", "wasteful", "unnecessary", "frivolous", ` +
      `"shouldn't", "you need to stop", or "overspent" (say "ran higher than your own target" instead); never imply ` +
      `a category is frivolous or that the family is failing; no category (groceries, childcare, health included) ` +
      `is ever singled out as more discretionary than another — the voice is a humble coach offering an option, not ` +
      `an auditor issuing a verdict.\n` +
      `- NO INVENTED TARGETS: never describe any category, fund, or line as having a "budget," "target," or ` +
      `"limit" unless one is explicitly present in the given data for that specific item (e.g. a real target inside ` +
      `"coaching.sourceCategory"). A category with no such figure given may be described only by its actual spend ` +
      `("$X on Groceries this month") — never as "within budget," "on budget," or "over budget," since no budget ` +
      `was ever set for it.`;

    // ── Generate review, then a post-generation category-sourcing guard ──────
    // Fix 3 (2026-07-28): plan.seedCategories/monthlyBudget.categories reach
    // this prompt in full regardless of coaching.sourceCategory (a confirmed,
    // real leak — not yet observed exploited live, but defense-in-depth, not
    // the primary gate). If the model names a category other than the one
    // sanctioned as a money source, retry once; if the retry also fails,
    // replace reviewText with a deterministic, honest fallback rather than
    // ship an unproven source.
    const allowedSourceCategoryName = sourceCategory?.categoryName ?? null;

    async function generateReviewText(): Promise<string> {
      const reviewMessage = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 1500,
        messages: [{ role: 'user', content: reviewPrompt }],
      });
      return reviewMessage.content[0].type === 'text' ? reviewMessage.content[0].text : '';
    }

    let reviewText = await generateReviewText();
    if (findUnsanctionedSourcingMention(reviewText, [...SEED_CATEGORIES], allowedSourceCategoryName)) {
      reviewText = await generateReviewText();
      if (findUnsanctionedSourcingMention(reviewText, [...SEED_CATEGORIES], allowedSourceCategoryName)) {
        reviewText = buildFallbackReviewText(reviewMonthName, locale);
      }
    }

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
