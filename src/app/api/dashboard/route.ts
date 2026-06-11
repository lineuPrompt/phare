import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

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

    // Latest budget month for this household (versioning-friendly: always "latest")
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

    // Budgets joined with their categories, for the latest month only
    const { data: budgets } = await supabase
      .from('budgets')
      .select('amount, categories(name, type)')
      .eq('household_id', householdId)
      .eq('month', latestBudget.month);

    const { data: sinkingFunds } = await supabase
      .from('sinking_funds')
      .select('name, annual_amount, monthly_provision, due_month, current_balance')
      .eq('household_id', householdId);

    const { data: goals } = await supabase
      .from('goals')
      .select('name, target_amount, current_amount, status')
      .eq('household_id', householdId);

    // Latest review from conversations
    const { data: conversation } = await supabase
      .from('conversations')
      .select('messages, created_at')
      .eq('household_id', householdId)
      .in('type', ['onboarding', 'monthly_review'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Shape the response
    type BudgetRow = { amount: number; categories: { name: string; type: string } | null };
    const lines = (budgets as BudgetRow[] | null) ?? [];

    const income = lines.filter((b) => b.categories?.type === 'income');
    const expenses = lines.filter((b) => b.categories?.type === 'expense');
    const totalIncome = income.reduce((s, b) => s + Number(b.amount), 0);
    const totalExpenses = expenses.reduce((s, b) => s + Number(b.amount), 0);

    type Message = { role: string; type: string; content: string; locale?: string };
    const messages = (conversation?.messages as Message[] | null) ?? [];
    const review = messages.find((m) => m.type === 'monthly_review')?.content ?? null;
    const topRecommendation = messages.find((m) => m.type === 'top_recommendation')?.content ?? null;

    return NextResponse.json({
      hasPlan: true,
      firstName: (userRow.full_name || '').split(' ')[0],
      month: latestBudget.month,
      summary: {
        totalIncome,
        totalExpenses,
        netCashFlow: Math.round((totalIncome - totalExpenses) * 100) / 100,
      },
      categories: lines.map((b) => ({
        name: b.categories?.name ?? '',
        type: b.categories?.type ?? 'expense',
        amount: Number(b.amount),
      })),
      sinkingFunds: sinkingFunds ?? [],
      goals: goals ?? [],
      review,
      topRecommendation,
      reviewDate: conversation?.created_at ?? null,
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    return NextResponse.json({ error: 'Failed to load dashboard' }, { status: 500 });
  }
}