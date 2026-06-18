import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { formatLocalDate, formatLocalMonth, materializeRule, monthNameToNumber } from '@/lib/dateHelpers';

type PlanCategory = {
  name: string;
  budgeted: number;
  type: string;
  seedCategory?: string;
  isFixed?: boolean;
};

export async function POST(request: Request) {
  try {
    const { plan, reviewText, locale } = await request.json();

    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: userRow, error: userError } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();
    if (userError || !userRow?.household_id) {
      return NextResponse.json({ error: 'No household found' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    const { data: member } = await supabase
      .from('household_members')
      .select('id')
      .eq('household_id', householdId)
      .eq('user_id', user.id)
      .single();
    const memberId = member?.id ?? null;

    // ----- Resolve accounts: chequing (base) + first card if any -----
    const { data: accts } = await supabase
      .from('accounts')
      .select('id, type')
      .eq('household_id', householdId);

    const chequingId = accts?.find((a) => a.type === 'chequing')?.id ?? null;
    const firstCardId = accts?.find((a) => a.type === 'credit_card')?.id ?? null;
    // Variable spending defaults to the card if one exists, else chequing
    const variableAccountId = firstCardId ?? chequingId;
    if (!chequingId || !variableAccountId) {
      return NextResponse.json({ error: 'A chequing account is required before saving a plan' }, { status: 400 });
    }

    const now = new Date();
    const today = formatLocalDate(now);
    const currentMonth = formatLocalMonth(now);
    const monthDate = `${currentMonth}-01`;
    const anchorDate = `${currentMonth}-01`;

    // ----- Wipe existing plan data -----
    await supabase.from('budgets').delete().eq('household_id', householdId);
    await supabase
      .from('transactions')
      .delete()
      .eq('household_id', householdId)
      .not('recurring_item_id', 'is', null)
      .gte('date', today);
    await supabase.from('recurring_items').delete().eq('household_id', householdId);
    await supabase.from('categories').delete().eq('household_id', householdId);
    await supabase.from('sinking_funds').delete().eq('household_id', householdId);
    await supabase.from('goals').delete().eq('household_id', householdId);

    // ----- Seed the fixed category set -----
    const seedNames: string[] = plan.seedCategories ?? [
      'Housing', 'Transportation', 'Restaurants', 'Groceries & Pharmacy',
      'Utilities & Subscriptions', 'Childcare', 'Shopping',
      'Health & Personal', 'Installments', 'Unexpected',
    ];

    const { data: seededCats } = await supabase
      .from('categories')
      .insert(seedNames.map((name) => ({
        household_id: householdId,
        name,
        type: 'expense',
        is_sinking_fund: false,
      })))
      .select('id, name');

    const catByName = new Map<string, string>();
    for (const c of seededCats ?? []) {
      catByName.set(c.name.trim().toLowerCase(), c.id);
    }
    const unexpectedId = catByName.get('unexpected') ?? (seededCats?.[0]?.id ?? null);
    const resolveCat = (seed?: string) =>
      (seed && catByName.get(seed.trim().toLowerCase())) || unexpectedId;

    // ----- Route each plan line -----
    const sinkingFundNames = new Set(
      (plan.sinkingFunds ?? []).map((f: { name: string }) => f.name.trim().toLowerCase())
    );

    const recurringRows: Record<string, unknown>[] = [];
    const budgetByCat = new Map<string, number>();

    for (const cat of (plan.monthlyBudget.categories as PlanCategory[])) {
      if (sinkingFundNames.has(cat.name.trim().toLowerCase())) continue;

      if (cat.type === 'income') {
        recurringRows.push({
          household_id: householdId,
          member_id: memberId,
          category_id: null,
          description: cat.name,
          amount: cat.budgeted,
          type: 'income',
          cadence: 'monthly',
          anchor_date: anchorDate,
          second_day: null,
          account_id: chequingId,
        });
        continue;
      }

      const categoryId = resolveCat(cat.seedCategory);

      if (cat.isFixed) {
        // Fixed expense → recurring item, paid from chequing
        recurringRows.push({
          household_id: householdId,
          member_id: memberId,
          category_id: categoryId,
          description: cat.name,
          amount: cat.budgeted,
          type: 'expense',
          cadence: 'monthly',
          anchor_date: anchorDate,
          second_day: null,
          account_id: chequingId,
        });
      } else {
        // Variable expense → contributes to its category's budget (lands on card)
        budgetByCat.set(categoryId, (budgetByCat.get(categoryId) ?? 0) + Number(cat.budgeted));
      }
    }

    // ----- Insert recurring items + materialize 12 months of transactions -----
    if (recurringRows.length) {
      const { data: insertedItems, error: recurringError } = await supabase
        .from('recurring_items')
        .insert(recurringRows)
        .select('id, description, amount, type, cadence, anchor_date, second_day, category_id, account_id');

      if (recurringError) {
        console.error('Save plan recurring insert error:', recurringError);
        return NextResponse.json({ error: 'Failed to save recurring items' }, { status: 500 });
      }

      const txnRows: Record<string, unknown>[] = [];

      for (const item of insertedItems ?? []) {
        const { error: cleanupError } = await supabase
          .from('transactions')
          .delete()
          .eq('household_id', householdId)
          .eq('recurring_item_id', item.id)
          .gte('date', monthDate);

        if (cleanupError) {
          console.error('Save plan materialize cleanup error:', cleanupError);
          return NextResponse.json({ error: 'Failed to prepare recurring transactions' }, { status: 500 });
        }

        const dates = materializeRule(
          {
            cadence: item.cadence as 'monthly' | 'biweekly' | 'semimonthly',
            anchorDate: item.anchor_date,
            secondDay: item.second_day,
          },
          currentMonth,
          12
        );
        for (const d of dates) {
          txnRows.push({
            household_id: householdId,
            member_id: memberId,
            category_id: item.category_id,
            amount: item.amount,
            description: item.description,
            date: d,
            type: item.type,
            source: 'manual',
            recurring_item_id: item.id,
            account_id: item.account_id,
          });
        }
      }

      if (txnRows.length) {
        const { error: txError } = await supabase.from('transactions').insert(txnRows);
        if (txError) {
          console.error('Save plan materialize insert error:', txError);
          return NextResponse.json({ error: 'Failed to save recurring transactions' }, { status: 500 });
        }
      }
    }

    // ----- Insert category budgets (summed variable spending per category) -----
    const budgetRows = [...budgetByCat.entries()].map(([categoryId, amount]) => ({
      household_id: householdId,
      category_id: categoryId,
      month: monthDate,
      amount: Math.round(amount * 100) / 100,
    }));
    if (budgetRows.length) {
      await supabase.from('budgets').insert(budgetRows);
    }

    // ----- Sinking funds -----
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

    // ----- Goals -----
    if (plan.goals?.length) {
      await supabase.from('goals').insert(
        plan.goals.map((g: { name: string; targetAmount: number }) => ({
          household_id: householdId,
          name: g.name,
          target_amount: g.targetAmount,
        }))
      );
    }

    // ----- Review -----
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
