import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { computeMonthTotals, GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { logEvent, isFirstReturnToday } from '@/lib/eventLogger';

export async function GET() {
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
    // Fire-and-forget — do not block the dashboard response.
    isFirstReturnToday(supabase, householdId, user.id).then((first) => {
      if (first) {
        void logEvent(supabase, householdId, user.id, 'returned', {
          date: new Date().toISOString().slice(0, 10),
        });
      }
    }).catch(() => {});

    // Active month: determined by when the plan was last saved.
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

    const monthStart = latestBudget.month as string; // YYYY-MM-01
    const [y, m] = monthStart.slice(0, 7).split('-').map(Number);
    const monthEnd = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // Fetch transactions and accounts in parallel.
    // Note: legacy `goals` table is intentionally NOT queried here.
    // Goal data is now represented as goal accounts (type in GOAL_ACCOUNT_TYPES).
    // Account balances are omitted from goalAccounts — they will be wired when
    // the goals UI calls computeGoalBalance with the account's full transaction history.
    const [txResult, acctResult, budgetResult, sfResult, convResult] =
      await Promise.all([
        supabase
          .from('transactions')
          .select('amount, type, account_id')
          .eq('household_id', householdId)
          .gte('date', monthStart)
          .lt('date', monthEnd),

        supabase
          .from('accounts')
          .select('id, name, type, goal_target, goal_target_date')
          .eq('household_id', householdId),

        supabase
          .from('budgets')
          .select('amount, category_id, categories(name, type)')
          .eq('household_id', householdId)
          .eq('month', monthStart),

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

    // Headline totals come from the actual ledger, not the plan.
    // Money-out = chequing expenses only (see dashboardHelpers.ts for the
    // double-count rule).
    const allAccounts = acctResult.data ?? [];
    const summary = computeMonthTotals(txResult.data ?? [], allAccounts);

    const goalAccounts = allAccounts
      .filter((a) => (GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type))
      .map((a) => ({ id: a.id, name: a.name, type: a.type, goalTarget: a.goal_target, goalTargetDate: a.goal_target_date }));

    // Budgets are kept as planned-comparison data only.
    type BudgetRow = { amount: number; category_id: string; categories: { name: string; type: string } | null };
    const budgetRows = (budgetResult.data as BudgetRow[] | null) ?? [];
    const categories = budgetRows.map((b) => ({
      name:   b.categories?.name ?? '',
      type:   b.categories?.type ?? 'expense',
      amount: Number(b.amount),
    }));

    type Message = { role: string; type: string; content: string; locale?: string };
    const messages = (convResult.data?.messages as Message[] | null) ?? [];
    const review            = messages.find((m) => m.type === 'monthly_review')?.content ?? null;
    const topRecommendation = messages.find((m) => m.type === 'top_recommendation')?.content ?? null;

    return NextResponse.json({
      hasPlan: true,
      firstName:         (userRow.full_name || '').split(' ')[0],
      month:             monthStart,
      summary, // includes totalIncome, totalExpenses, totalSavings, netCashFlow
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
