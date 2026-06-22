import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { computeMonthTotals, computeGoalBalance, GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { logEvent, isFirstReturnToday } from '@/lib/eventLogger';

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

    // Plan existence check: the latest budget row determines whether a plan has been saved.
    const { data: latestBudget } = await supabase
      .from('budgets')
      .select('month')
      .eq('household_id', householdId)
      .order('month', { ascending: false })
      .limit(1)
      .single();

    if (!latestBudget) {
      return NextResponse.json({ hasPlan: false });
    }

    // Actuals month: caller-selected (YYYY-MM) or the current calendar month.
    // The dashboard shows actual income/expenses/net for this month so it
    // advances automatically as the calendar rolls over.
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month');
    let actualsMonth: string;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      actualsMonth = `${monthParam}-01`;
    } else {
      const now = new Date();
      const y = now.getFullYear();
      const mo = now.getMonth() + 1;
      actualsMonth = `${y}-${String(mo).padStart(2, '0')}-01`;
    }
    const [ay, am] = actualsMonth.slice(0, 7).split('-').map(Number);
    const actualsMonthEnd = am === 12
      ? `${ay + 1}-01-01`
      : `${ay}-${String(am + 1).padStart(2, '0')}-01`;

    // Plan month: the month of the most recent saved budget.
    // Used only for budget-vs-actual comparison. Budgets don't exist for months
    // that haven't been planned, so we never fake a budget for the current month.
    const planMonth = latestBudget.month as string;

    const [txResult, acctResult, budgetResult, sfResult, convResult] =
      await Promise.all([
        // Transactions for the ACTUALS month (not the plan month)
        supabase
          .from('transactions')
          .select('amount, type, account_id')
          .eq('household_id', householdId)
          .gte('date', actualsMonth)
          .lt('date', actualsMonthEnd),

        supabase
          .from('accounts')
          .select('id, name, type, goal_target, goal_target_date')
          .eq('household_id', householdId),

        // Budget comparison always references the plan month
        supabase
          .from('budgets')
          .select('amount, category_id, categories(name, type)')
          .eq('household_id', householdId)
          .eq('month', planMonth),

        supabase
          .from('sinking_funds')
          .select('name, annual_amount, monthly_provision, due_month, current_balance')
          .eq('household_id', householdId),

        supabase
          .from('conversations')
          .select('messages, created_at')
          .eq('household_id', householdId)
          .in('type', ['onboarding', 'monthly_review'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

    const allAccounts = acctResult.data ?? [];

    // Headline totals from the actual ledger for the displayed month.
    const summary = computeMonthTotals(txResult.data ?? [], allAccounts);

    // Fetch FULL (all-time) transaction history for goal accounts so that
    // computeGoalBalance sees every deposit, not just the active month.
    const goalAccountList = allAccounts.filter(
      (a) => (GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type)
    );
    const goalIds = goalAccountList.map((a) => a.id);

    let goalTxData: { amount: number | string; type: string; account_id: string | null }[] = [];
    if (goalIds.length > 0) {
      const { data } = await supabase
        .from('transactions')
        .select('amount, type, account_id')
        .eq('household_id', householdId)
        .in('account_id', goalIds);
      goalTxData = data ?? [];
    }

    const goalAccounts = goalAccountList.map((a) => ({
      id:             a.id,
      name:           a.name,
      type:           a.type,
      balance:        computeGoalBalance(goalTxData, a.id),
      goalTarget:     a.goal_target ? Number(a.goal_target) : null,
      goalTargetDate: a.goal_target_date ?? null,
    }));

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

    return NextResponse.json({
      hasPlan: true,
      firstName:         (userRow.full_name || '').split(' ')[0],
      month:             actualsMonth,
      planMonth,
      summary,
      categories,
      sinkingFunds:  sfResult.data ?? [],
      goalAccounts,
      review,
      topRecommendation,
      reviewDate:        convResult.data?.created_at ?? null,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}
