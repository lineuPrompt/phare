import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const { plan, reviewText, locale } = await request.json();

    const supabase = await createClient();

    // Who is this?
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Find their household
    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();
    if (userError || !userRow?.household_id) {
      return NextResponse.json({ error: 'No household found' }, { status: 400 });
    }
    const householdId = userRow.household_id;
    const month = new Date();
    const monthDate = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-01`;

    // Replace existing plan data (simple wipe-and-insert for MVP)
    await supabase.from('budgets').delete().eq('household_id', householdId);
    await supabase.from('categories').delete().eq('household_id', householdId);
    await supabase.from('sinking_funds').delete().eq('household_id', householdId);
    await supabase.from('goals').delete().eq('household_id', householdId);

    // Names that are sinking funds — these must NOT become monthly budget lines
    const sinkingFundNames = new Set(
      (plan.sinkingFunds ?? []).map((f: { name: string }) => f.name.trim().toLowerCase())
    );

    // Categories + budgets (excluding sinking funds)
    for (const cat of plan.monthlyBudget.categories) {
      if (sinkingFundNames.has(cat.name.trim().toLowerCase())) continue;

      const { data: catRow, error: catError } = await supabase
        .from('categories')
        .insert({
          household_id: householdId,
          name: cat.name,
          type: cat.type === 'income' ? 'income' : 'expense',
          is_sinking_fund: false,
        })
        .select('id')
        .single();
      if (catError || !catRow) continue;

      await supabase.from('budgets').insert({
        household_id: householdId,
        category_id: catRow.id,
        month: monthDate,
        amount: cat.budgeted,
      });
    }

    // Sinking funds
    if (plan.sinkingFunds?.length) {
      await supabase.from('sinking_funds').insert(
        plan.sinkingFunds.map((f: { name: string; annualAmount: number; dueMonth: string }) => ({
          household_id: householdId,
          name: f.name,
          annual_amount: f.annualAmount,
          due_month: monthNameToNumber(f.dueMonth),
        }))
      );
    }

    // Goals
    if (plan.goals?.length) {
      await supabase.from('goals').insert(
        plan.goals.map((g: { name: string; targetAmount: number }) => ({
          household_id: householdId,
          name: g.name,
          target_amount: g.targetAmount,
        }))
      );
    }

    // The review + recommendation as the first conversation entry
    await supabase.from('conversations').insert({
      household_id: householdId,
      user_id: user.id,
      type: 'onboarding',
      messages: [
        { role: 'assistant', type: 'top_recommendation', content: plan.topRecommendation, locale },
        { role: 'assistant', type: 'monthly_review', content: reviewText, locale },
      ],
    });

    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error('Save plan error:', error);
    return NextResponse.json({ error: 'Failed to save plan' }, { status: 500 });
  }
}

function monthNameToNumber(name: string): number | null {
  const months: Record<string, number> = {
    january: 1, janvier: 1, february: 2, février: 2, march: 3, mars: 3,
    april: 4, avril: 4, may: 5, mai: 5, june: 6, juin: 6,
    july: 7, juillet: 7, august: 8, août: 8, september: 9, septembre: 9,
    october: 10, octobre: 10, november: 11, novembre: 11, december: 12, décembre: 12,
  };
  const low = (name || '').toLowerCase();
  for (const [key, num] of Object.entries(months)) {
    if (low.includes(key)) return num;
  }
  return null;
}