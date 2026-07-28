import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { computeGoalBalance, computeMonthTotals, GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { evaluateGoals, isDebtGoalName, computeDebtPayoff } from '@/lib/goalHelpers';
import { householdCategoryActualsSplit, CategorySpendTx } from '@/lib/categorySpendHelpers';
import { businessToday, businessMonth } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

function monthBounds(month: string): { start: string; end: string } {
  const start = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const end = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { start, end };
}

// GET /api/reports?month=YYYY-MM — data for the Reports page (charts A/B/C).
// Every figure here is produced by an existing, already-tested helper
// (computeGoalBalance, evaluateGoals, computeDebtPayoff,
// householdCategoryActualsSplit) — this route only fetches and passes
// through, same convention as /api/dashboard.
export async function GET(request: Request) {
  try {
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

    // Same plan-existence gate /api/dashboard uses (file_imports: one row
    // per completed save-plan run, regardless of source).
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

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const today = businessToday(timezone);
    const currentMonth = businessMonth(timezone); // YYYY-MM — always "now", never navigated

    // The month charts A/B are scoped to — navigable via ?month=, defaulting
    // to currentMonth. Chart C (goals) deliberately does NOT use this: it
    // always reads currentMonth's capacity and `today`'s balances, regardless
    // of what the family is browsing here (see goalAccounts block below) —
    // "Goal progress — as of today" must never silently mix with a past
    // month's spending.
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month');
    const viewedMonth = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : currentMonth;

    const { start: viewedMonthStart, end: viewedMonthEnd } = monthBounds(viewedMonth);
    const { start: currentMonthStart, end: currentMonthEnd } = monthBounds(currentMonth);

    const { data: rawAccounts } = await supabase
      .from('accounts')
      .select('id, name, type, goal_target, goal_target_date, is_sinking_fund')
      .eq('household_id', householdId);
    const accounts = rawAccounts ?? [];

    // Plan month for budget targets: latest saved budget row, independent of
    // viewedMonth — budgets is a one-time plan snapshot (save-plan writes it
    // once), not a per-month recurring entry like card envelopes, so the
    // same target applies no matter which month's actuals are being viewed.
    const { data: latestBudget } = await supabase
      .from('budgets')
      .select('month')
      .eq('household_id', householdId)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();
    const planMonth = (latestBudget?.month as string | undefined) ?? viewedMonthStart;

    const [
      { data: budgetRows },
      { data: allCategories },
      { data: rawTxns },
    ] = await Promise.all([
      supabase
        .from('budgets')
        .select('category_id, amount, categories(name, name_fr)')
        .eq('household_id', householdId)
        .eq('month', planMonth),
      supabase
        .from('categories')
        .select('id, name, name_fr')
        .eq('household_id', householdId)
        .eq('type', 'expense'),
      supabase
        .from('transactions')
        // recurring_item_id is the fixed/variable split signal (see
        // categorySpendHelpers.ts's file header for why it's this column and
        // not recurrence_id) — additive over step 1/1b's select.
        .select('id, amount, type, account_id, category_id, date, is_bridge, recurring_item_id')
        .eq('household_id', householdId)
        .gte('date', viewedMonthStart)
        .lt('date', viewedMonthEnd),
    ]);

    type BudgetRow = { category_id: string; amount: number; categories: { name: string; name_fr: string | null } | null };
    const budgetCategories = ((budgetRows ?? []) as unknown as BudgetRow[]).map((b) => ({
      categoryId: b.category_id,
      name: b.categories?.name ?? '',
      nameFr: b.categories?.name_fr ?? null,
      amount: Number(b.amount),
    }));

    const categories = (allCategories ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      nameFr: (c.name_fr as string | null) ?? null,
    }));

    const txns = (rawTxns ?? []) as CategorySpendTx[];
    // Today cutoff only actually excludes anything when viewedMonth is the
    // current month (a past month's rows are all already ≤ today; a future
    // month's rows are all > today and the whole month comes back empty,
    // correctly — nothing has been spent yet in a month that hasn't arrived).
    const { variable, fixed } = householdCategoryActualsSplit(txns, accounts, viewedMonth, today);
    const variableActuals = Array.from(variable.entries()).map(([categoryId, actual]) => ({ categoryId, actual }));
    const fixedActuals = Array.from(fixed.entries()).map(([categoryId, actual]) => ({ categoryId, actual }));

    // Goal progress — identical computation to /api/dashboard's goalAccounts
    // block (computeGoalBalance / evaluateGoals / computeDebtPayoff), reused
    // rather than reimplemented, on this route's own fresh query. Always
    // anchored to `today`/currentMonth, never viewedMonth — see the note above.
    const goalTypeAccounts = accounts.filter((a) => (GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type));
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

    // Household net cash flow for THIS (current, real) month, needed by
    // evaluateGoals — reuse the exact same chequing-scoped
    // transactions/accounts computeMonthTotals would use. Fetched once more
    // here rather than importing the dashboard route's already-computed
    // value (routes don't share request state). Deliberately currentMonth,
    // not viewedMonth.
    const { data: currentMonthTxns } = await supabase
      .from('transactions')
      .select('id, amount, type, account_id, transfer_peer_id')
      .eq('household_id', householdId)
      .gte('date', currentMonthStart)
      .lt('date', currentMonthEnd);
    const summary = computeMonthTotals(currentMonthTxns ?? [], accounts);

    const withTarget = goalAccountList.filter((a) => a.goal_target != null);
    const rawGoalsForVerdict = withTarget.map((a) => ({
      accountId: a.id,
      name: a.name,
      targetAmount: Number(a.goal_target),
      savedSoFar: computeGoalBalance(goalTxData, a.id, today),
      targetDate: a.goal_target_date ?? null,
      isDebt: a.type === 'debt',
    }));
    const explicitDebtAcct = rawGoalsForVerdict.find((g) => g.isDebt);
    const debtLineAcct = explicitDebtAcct ?? rawGoalsForVerdict.find((g) => isDebtGoalName(g.name));
    const nonDebtGoalsAcct = rawGoalsForVerdict.filter((g) => g !== debtLineAcct);
    const verdicts = evaluateGoals(nonDebtGoalsAcct, summary.netCashFlow, today);
    const verdictByAccountId = new Map(nonDebtGoalsAcct.map((g, i) => [g.accountId, verdicts[i]]));
    const debtPayoffAcct = debtLineAcct ? computeDebtPayoff(debtLineAcct, today) : null;

    const goalAccounts = goalAccountList.map((a) => {
      const verdict = verdictByAccountId.get(a.id) ?? null;
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        isDebt: a.type === 'debt',
        balance: computeGoalBalance(goalTxData, a.id, today),
        goalTarget: a.goal_target != null ? Number(a.goal_target) : null,
        goalTargetDate: a.goal_target_date ?? null,
        onTrack: verdict?.onTrack ?? null,
        monthlyContribution: verdict?.monthlyContribution ?? null,
        estimatedDate: verdict?.estimatedDate ?? null,
        debtPayoff: debtLineAcct?.accountId === a.id ? debtPayoffAcct : null,
      };
    });

    return NextResponse.json({
      hasPlan: true,
      month: viewedMonth,
      budgetCategories,
      variableActuals,
      fixedActuals,
      categories,
      goalAccounts,
    });
  } catch (error) {
    console.error('GET /api/reports error:', error);
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
  }
}
