import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { computeMonthTotals, computeGoalBalance, GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { evaluateGoals, isDebtGoalName, computeDebtPayoff, addMonthsToMonth } from '@/lib/goalHelpers';
import { ensureBridgesForWindow } from '@/lib/bridgeHelpers';
import { logEvent, isFirstReturnToday } from '@/lib/eventLogger';
import { businessToday, businessMonth } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id, full_name')
      .eq('id', user.id)
      .single();

    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    // Diary: once-per-UTC-day "user was active" heartbeat.
    isFirstReturnToday(supabase, householdId, user.id).then((first) => {
      if (first) {
        void logEvent(supabase, householdId, user.id, 'returned', {
          date: new Date().toISOString().slice(0, 10),
        });
      }
    }).catch(() => {});

    // Plan existence check: file_imports is the one row EVERY completed
    // save-plan run inserts unconditionally (buildFileImportRow in
    // importProvenance.ts), regardless of source or which categories the
    // plan contains — template and manual entry write it via the exact same
    // call, no branching. budgets used to be the proxy here, but budgets is
    // only populated when the plan has at least one VARIABLE-expense
    // category; a genuinely minimal manual entry (e.g. salary + rent, no
    // day-to-day spending categories) legitimately has zero, and this gate
    // was reporting "no plan" for a fully saved, valid one. Template plans
    // happened to always clear it only because the template ships with
    // non-zero example values pre-filled into Variable Expenses — an
    // accident of the template's defaults, not a real distinction between
    // the two onboarding paths. file_imports has no such accident: it's a
    // true one-row-per-save contract shared by both writers.
    const { data: latestImport } = await supabase
      .from('file_imports')
      .select('id')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!latestImport) {
      return NextResponse.json({ hasPlan: false });
    }

    // Actuals month: caller-selected (YYYY-MM) or the current calendar month.
    // The dashboard shows actual income/expenses/net for this month so it
    // advances automatically as the calendar rolls over.
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month');
    // Snapshot month-switching (dashboard/page.tsx) hits this same route
    // with snapshotOnly=1 so it can update just the SnapshotCard's figures
    // without re-fetching or re-rendering goals/sinking funds/the AI review —
    // sections that don't depend on which month the snapshot is viewing.
    // One route, one set of month-scoped helpers (computeMonthTotals,
    // ensureBridgesForWindow) — snapshotOnly only skips queries whose
    // results this response wouldn't use, never a parallel computation.
    const snapshotOnly = url.searchParams.get('snapshotOnly') === '1';
    const timezone = await getHouseholdTimezone(supabase, householdId);
    let actualsMonth: string;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      actualsMonth = `${monthParam}-01`;
    } else {
      actualsMonth = `${businessMonth(timezone)}-01`;
    }
    const [ay, am] = actualsMonth.slice(0, 7).split('-').map(Number);
    const actualsMonthEnd = am === 12
      ? `${ay + 1}-01-01`
      : `${ay}-${String(am + 1).padStart(2, '0')}-01`;

    // Plan month: the month of the most recent saved budget, when one
    // exists — used only for budget-vs-actual comparison. A household with
    // no variable-expense categories has no budget rows at all (honest:
    // there is nothing to compare), so this falls back to the actuals
    // month rather than gating plan existence on it. Not needed at all for
    // snapshotOnly — skipped there, same as the other non-snapshot queries.
    let planMonth = actualsMonth;
    if (!snapshotOnly) {
      const { data: latestBudget } = await supabase
        .from('budgets')
        .select('month')
        .eq('household_id', householdId)
        .order('month', { ascending: false })
        .limit(1)
        .maybeSingle();
      planMonth = (latestBudget?.month as string | undefined) ?? actualsMonth;
    }

    // Accounts are fetched up front (not inside the Promise.all below) because
    // a viewed month's credit-card bridge payment must be ensured in the
    // ledger BEFORE the transactions query for that month runs — the same
    // ordering constraint timeline/route.ts already follows. Without this,
    // navigating the snapshot to a future month whose bridge was never
    // materialized (e.g. the user never opened Timeline for that range)
    // would silently understate that month's expenses.
    const { data: rawAccounts } = await supabase
      .from('accounts')
      .select('id, name, type, goal_target, goal_target_date, payment_day, statement_close_day, is_sinking_fund')
      .eq('household_id', householdId);
    const allAccounts = rawAccounts ?? [];

    const chequingAccount = allAccounts.find((a) => a.type === 'chequing');
    const cardAccounts = allAccounts.filter((a) => a.type === 'credit_card');

    // Snapshot's lower navigation bound: the same "no data before the
    // earliest known real balance" boundary Timeline already enforces
    // (selectAnchorsForTimeline). Without this, paging the snapshot back
    // past that point shows a misleadingly empty/partial month that predates
    // any real anchor — one extra cheap query, reusing the chequing account
    // already resolved above; no parallel anchor-selection logic.
    let earliestAnchorMonth: string | null = null;
    if (chequingAccount) {
      const { data: earliestAnchor } = await supabase
        .from('account_balance_anchors')
        .select('anchor_date')
        .eq('household_id', householdId)
        .eq('account_id', chequingAccount.id)
        .order('anchor_date', { ascending: true })
        .limit(1)
        .maybeSingle();
      earliestAnchorMonth = earliestAnchor ? (earliestAnchor.anchor_date as string).slice(0, 7) : null;
    }

    if (chequingAccount && cardAccounts.length > 0) {
      const { data: memberRow } = await supabase
        .from('household_members')
        .select('id')
        .eq('household_id', householdId)
        .eq('user_id', user.id)
        .single();
      const memberId = (memberRow?.id ?? null) as string | null;

      const cards = cardAccounts.map((a) => ({
        id: a.id as string,
        name: a.name as string,
        payment_day: (a.payment_day ?? null) as number | null,
        statement_close_day: (a.statement_close_day ?? null) as number | null,
      }));

      // A bridge payment for spend month M appears in the chequing ledger in
      // month M+1 (bridgeHelpers.ts), so the spend month whose bridge lands
      // in the viewed actualsMonth is one month earlier.
      const spendMonth = addMonthsToMonth(actualsMonth.slice(0, 7), -1);

      await ensureBridgesForWindow({
        supabase,
        householdId,
        chequingId: chequingAccount.id as string,
        memberId,
        cards,
        spendMonths: [spendMonth],
      });
    }

    const [txResult, budgetResult, sfResult, convResult, unanchoredIncomeResult, unanchoredExpenseResult] =
      await Promise.all([
        // Transactions for the ACTUALS month (not the plan month)
        supabase
          .from('transactions')
          .select('amount, type, account_id')
          .eq('household_id', householdId)
          .gte('date', actualsMonth)
          .lt('date', actualsMonthEnd),

        // Budget comparison always references the plan month. Skipped
        // entirely for snapshotOnly — nothing in that response reads it.
        snapshotOnly
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from('budgets')
              .select('amount, category_id, categories(name, type)')
              .eq('household_id', householdId)
              .eq('month', planMonth),

        snapshotOnly
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from('sinking_funds')
              .select('id, name, annual_amount, monthly_provision, due_month, linked_account_id')
              .eq('household_id', householdId),

        snapshotOnly
          ? Promise.resolve({ data: null, error: null })
          : supabase
              .from('conversations')
              .select('messages, created_at')
              .eq('household_id', householdId)
              .in('type', ['onboarding', 'monthly_review'])
              .order('created_at', { ascending: false })
              .limit(1)
              .maybeSingle(),

        // Income and expense recurring items with no known pay date yet —
        // real cadence and amount are saved, but nothing is materialized for
        // them, so this month's actual totals can understate the plan's.
        // Both types, not just income — a bill with no anchor understates
        // expenses exactly the same way an unanchored paycheque understates income.
        supabase
          .from('recurring_items')
          .select('id', { count: 'exact', head: true })
          .eq('household_id', householdId)
          .eq('type', 'income')
          .eq('active', true)
          .is('anchor_date', null),

        supabase
          .from('recurring_items')
          .select('id', { count: 'exact', head: true })
          .eq('household_id', householdId)
          .eq('type', 'expense')
          .eq('active', true)
          .is('anchor_date', null),
      ]);

    // Headline totals from the actual ledger for the displayed month.
    const summary = computeMonthTotals(txResult.data ?? [], allAccounts);

    if (snapshotOnly) {
      return NextResponse.json({
        hasPlan: true,
        month: actualsMonth,
        summary,
        unanchoredIncomeCount: unanchoredIncomeResult.count ?? 0,
        unanchoredExpenseCount: unanchoredExpenseResult.count ?? 0,
        earliestAnchorMonth,
      });
    }

    // Fetch FULL (all-time) transaction history for goal accounts so that
    // computeGoalBalance sees every deposit, not just the active month.
    // goalTypeAccounts includes sinking-fund accounts (Build 4 Part 2,
    // 2026-07-21) — they're type='savings' too — so their balance can be
    // computed from the same fetch below; goalAccountList (used for the
    // Goals-card verdict/output) excludes them — a fund is not a goal, it
    // cycles, and it's surfaced through the sinkingFunds array instead so it
    // never renders twice.
    const goalTypeAccounts = allAccounts.filter(
      (a) => (GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type)
    );
    const goalAccountList = goalTypeAccounts.filter((a) => !a.is_sinking_fund);
    const goalIds = goalTypeAccounts.map((a) => a.id);

    let goalTxData: { amount: number | string; type: string; account_id: string | null; date?: string }[] = [];
    if (goalIds.length > 0) {
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, account_id, date')
        .eq('household_id', householdId)
        .in('account_id', goalIds);
      goalTxData = data ?? [];
    }

    const todayForGoalBalance = businessToday(timezone);

    // Part B.6: the code-computed on-track/debt-payoff verdict for each goal
    // renders on the dashboard adjacent to the AI review's prose (ReviewCard
    // sits right next to GoalsCard on this same page) — a defense-in-depth
    // measure alongside the reviewPrompt's hard "only restate the given
    // verdict" rule (regenerate-plan/route.ts): if narration ever drifts
    // from the real verdict despite that rule, the contradiction is visible
    // to the founder immediately, on the same screen, not just in prose.
    // Same evaluateGoals()/computeDebtPayoff() calls regenerate-plan uses.
    const withTarget = goalAccountList.filter((a) => a.goal_target != null);
    const rawGoalsForVerdict = withTarget.map((a) => ({
      accountId: a.id,
      name: a.name,
      targetAmount: Number(a.goal_target),
      savedSoFar: computeGoalBalance(goalTxData, a.id, todayForGoalBalance),
      targetDate: a.goal_target_date ?? null,
      isDebt: a.type === 'debt',
    }));
    const explicitDebtAcct = rawGoalsForVerdict.find((g) => g.isDebt);
    const debtLineAcct = explicitDebtAcct ?? rawGoalsForVerdict.find((g) => isDebtGoalName(g.name));
    const nonDebtGoalsAcct = rawGoalsForVerdict.filter((g) => g !== debtLineAcct);
    const verdicts = evaluateGoals(nonDebtGoalsAcct, summary.netCashFlow, todayForGoalBalance);
    const verdictByAccountId = new Map(nonDebtGoalsAcct.map((g, i) => [g.accountId, verdicts[i]]));
    const debtPayoffAcct = debtLineAcct ? computeDebtPayoff(debtLineAcct, todayForGoalBalance) : null;

    const goalAccounts = goalAccountList.map((a) => {
      const verdict = verdictByAccountId.get(a.id) ?? null;
      return {
        id:             a.id,
        name:           a.name,
        type:           a.type,
        isDebt:         a.type === 'debt',
        balance:        computeGoalBalance(goalTxData, a.id, todayForGoalBalance),
        goalTarget:     a.goal_target != null ? Number(a.goal_target) : null,
        goalTargetDate: a.goal_target_date ?? null,
        onTrack:             verdict?.onTrack ?? null,
        monthlyContribution: verdict?.monthlyContribution ?? null,
        estimatedDate:       verdict?.estimatedDate ?? null,
        debtPayoff:          debtLineAcct?.accountId === a.id ? debtPayoffAcct : null,
      };
    });

    type BudgetRow = { amount: number; category_id: string; categories: { name: string; type: string } | null };
    const budgetRows = (budgetResult.data as BudgetRow[] | null) ?? [];
    const categories = budgetRows.map((b) => ({
      name:   b.categories?.name ?? '',
      type:   b.categories?.type ?? 'expense',
      amount: Number(b.amount),
    }));

    type Message = { role: string; type: string; content: string; locale?: string };
    const messages = (convResult.data?.messages as Message[] | null) ?? [];
    const review            = messages.find((msg) => msg.type === 'monthly_review')?.content ?? null;
    const topRecommendation = messages.find((msg) => msg.type === 'top_recommendation')?.content ?? null;

    // Sinking funds: real balance is derived from the linked account's own
    // transaction ledger (Build 4 Part 2, 2026-07-21) — never a stored
    // current_balance column. linked_account_id null means the provision is
    // still dead (never started); fundedAlready mirrors the same real-vs-
    // planned signal goals already use (balance > 0), not just "has an
    // account", so the review's forward-looking framing stays consistent
    // for a fund whose first contribution hasn't posted yet either.
    type SinkingFundRow = {
      id: string; name: string; annual_amount: number; monthly_provision: number;
      due_month: number | null; linked_account_id: string | null;
    };
    const sinkingFundRows = (sfResult.data as SinkingFundRow[] | null) ?? [];
    const sinkingFunds = sinkingFundRows.map((sf) => {
      const balance = sf.linked_account_id
        ? computeGoalBalance(goalTxData, sf.linked_account_id, todayForGoalBalance)
        : 0;
      return {
        id: sf.id,
        name: sf.name,
        annual_amount: Number(sf.annual_amount),
        monthly_provision: Number(sf.monthly_provision),
        due_month: sf.due_month,
        current_balance: balance,
        fundedAlready: balance > 0,
        linkedAccountId: sf.linked_account_id,
      };
    });

    return NextResponse.json({
      hasPlan: true,
      firstName:         (userRow.full_name || '').split(' ')[0],
      month:             actualsMonth,
      planMonth,
      summary,
      categories,
      sinkingFunds,
      goalAccounts,
      review,
      topRecommendation,
      reviewDate:        convResult.data?.created_at ?? null,
      unanchoredIncomeCount: unanchoredIncomeResult.count ?? 0,
      unanchoredExpenseCount: unanchoredExpenseResult.count ?? 0,
      earliestAnchorMonth,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
