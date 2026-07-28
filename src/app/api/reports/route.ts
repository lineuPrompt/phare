import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { computeGoalBalance, computeMonthTotals, GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { evaluateGoals, isDebtGoalName, computeDebtPayoff } from '@/lib/goalHelpers';
import { householdCategoryActuals } from '@/lib/categorySpendHelpers';
import type { EnvTx } from '@/lib/envelopeHelpers';
import { businessToday, businessMonth } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

// GET /api/reports — data for the Reports page (charts A/B/C). Every figure
// here is produced by an existing, already-tested helper (computeGoalBalance,
// evaluateGoals, computeDebtPayoff, householdCategoryActuals) — this route
// only fetches and passes through, same convention as /api/dashboard.
export async function GET() {
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
    const month = businessMonth(timezone); // YYYY-MM
    const monthStart = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const monthEnd = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const { data: rawAccounts } = await supabase
      .from('accounts')
      .select('id, name, type, goal_target, goal_target_date, is_sinking_fund')
      .eq('household_id', householdId);
    const accounts = rawAccounts ?? [];

    // Plan month for budget targets: latest saved budget row, falling back to
    // the actuals month — identical fallback /api/dashboard uses, since
    // budgets is a one-time plan snapshot, not a per-month recurring entry
    // like card envelopes.
    const { data: latestBudget } = await supabase
      .from('budgets')
      .select('month')
      .eq('household_id', householdId)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();
    const planMonth = (latestBudget?.month as string | undefined) ?? monthStart;

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
        .select('id, amount, type, account_id, category_id, date, is_bridge')
        .eq('household_id', householdId)
        .gte('date', monthStart)
        .lt('date', monthEnd),
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

    const txns = (rawTxns ?? []) as EnvTx[];
    const actualsMap = householdCategoryActuals(txns, accounts, month);
    const categoryActuals = Array.from(actualsMap.entries()).map(([categoryId, actual]) => ({ categoryId, actual }));

    // Goal progress — identical computation to /api/dashboard's goalAccounts
    // block (computeGoalBalance / evaluateGoals / computeDebtPayoff), reused
    // rather than reimplemented, on this route's own fresh query.
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

    // Household net cash flow for this month, needed by evaluateGoals — reuse
    // the exact same chequing-scoped transactions/accounts computeMonthTotals
    // would use. Fetched once more here rather than importing the dashboard
    // route's already-computed value (routes don't share request state).
    const { data: monthTxns } = await supabase
      .from('transactions')
      .select('id, amount, type, account_id, transfer_peer_id')
      .eq('household_id', householdId)
      .gte('date', monthStart)
      .lt('date', monthEnd);
    const summary = computeMonthTotals(monthTxns ?? [], accounts);

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
      month,
      budgetCategories,
      categoryActuals,
      categories,
      goalAccounts,
    });
  } catch (error) {
    console.error('GET /api/reports error:', error);
    return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
  }
}
