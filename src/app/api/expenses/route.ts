import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

// POST: create expense (single, monthly recurring, or installments)
export async function POST(request: Request) {
  try {
    const { date, description, categoryId, amount, repeat, installments } = await request.json();

    if (!date || !description || !amount || !categoryId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    // The member entering the expense (their own member row)
    const { data: member } = await supabase
      .from('household_members')
      .select('id')
      .eq('household_id', householdId)
      .eq('user_id', user.id)
      .single();
    if (!member) return NextResponse.json({ error: 'No member record' }, { status: 400 });

    const baseDate = new Date(date + 'T00:00:00');

    type Row = {
      household_id: string;
      member_id: string;
      category_id: string;
      amount: number;
      description: string;
      date: string;
      type: string;
      source: string;
      recurrence_id: string | null;
      installment_label: string | null;
    };

    const rows: Row[] = [];
    const makeDate = (monthsAhead: number) => {
      const d = new Date(baseDate);
      d.setMonth(d.getMonth() + monthsAhead);
      return d.toISOString().slice(0, 10);
    };

    if (repeat === 'monthly') {
      const recurrenceId = crypto.randomUUID();
      for (let i = 0; i < 12; i++) {
        rows.push({
          household_id: householdId,
          member_id: member.id,
          category_id: categoryId,
          amount,
          description,
          date: makeDate(i),
          type: 'expense',
          source: 'manual',
          recurrence_id: recurrenceId,
          installment_label: null,
        });
      }
    } else if (repeat === 'installments' && installments > 1) {
      const recurrenceId = crypto.randomUUID();
      for (let i = 0; i < installments; i++) {
        rows.push({
          household_id: householdId,
          member_id: member.id,
          category_id: categoryId,
          amount,
          description,
          date: makeDate(i),
          type: 'expense',
          source: 'manual',
          recurrence_id: recurrenceId,
          installment_label: `${i + 1}/${installments}`,
        });
      }
    } else {
      rows.push({
        household_id: householdId,
        member_id: member.id,
        category_id: categoryId,
        amount,
        description,
        date,
        type: 'expense',
        source: 'manual',
        recurrence_id: null,
        installment_label: null,
      });
    }

    const { error: insertError } = await supabase.from('transactions').insert(rows);
    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to save expense' }, { status: 500 });
    }

    return NextResponse.json({ saved: true, count: rows.length });
  } catch (error) {
    console.error('Expense error:', error);
    return NextResponse.json({ error: 'Failed to save expense' }, { status: 500 });
  }
}

// GET: expenses + category summary for a given month (?month=2026-06)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month'); // '2026-06'
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    const monthStart = `${monthParam}-01`;
    const [y, m] = monthParam.split('-').map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // Expenses in the month
    const { data: txns } = await supabase
      .from('transactions')
      .select('id, date, description, amount, installment_label, recurrence_id, category_id, categories(name), household_members(name)')
      .eq('household_id', householdId)
      .eq('type', 'expense')
      .gte('date', monthStart)
      .lt('date', nextMonth)
      .order('date', { ascending: true });

    // Category budgets for the month (orçamento)
    const { data: budgets } = await supabase
      .from('budgets')
      .select('amount, category_id, categories(name, type)')
      .eq('household_id', householdId)
      .eq('month', monthStart);

    // All expense categories (for the entry form dropdown)
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name, type')
      .eq('household_id', householdId)
      .eq('type', 'expense')
      .order('name');

    // Card goal: this month's, or most recent before it (carry-forward)
    const { data: goalRow } = await supabase
      .from('monthly_goals')
      .select('card_goal, month')
      .eq('household_id', householdId)
      .lte('month', monthStart)
      .order('month', { ascending: false })
      .limit(1)
      .maybeSingle();

    // Build the summary: per category — budget, spent, difference
    type Txn = { amount: number; category_id: string | null };
    type BudgetRow = { amount: number; category_id: string; categories: { name: string; type: string } | null };

    const spentByCategory = new Map<string, number>();
    for (const t of (txns as Txn[] | null) ?? []) {
      if (!t.category_id) continue;
      spentByCategory.set(t.category_id, (spentByCategory.get(t.category_id) ?? 0) + Number(t.amount));
    }

    const summaryRows = ((budgets as BudgetRow[] | null) ?? [])
      .filter((b) => b.categories?.type === 'expense')
      .map((b) => {
        const spent = spentByCategory.get(b.category_id) ?? 0;
        return {
          categoryId: b.category_id,
          name: b.categories?.name ?? '',
          budget: Number(b.amount),
          spent: Math.round(spent * 100) / 100,
          difference: Math.round((Number(b.amount) - spent) * 100) / 100,
        };
      });

    // Categories with spending but no budget line still appear
    const budgetedIds = new Set(summaryRows.map((r) => r.categoryId));
    for (const [catId, spent] of spentByCategory) {
      if (!budgetedIds.has(catId)) {
        const cat = (categories ?? []).find((c) => c.id === catId);
        summaryRows.push({
          categoryId: catId,
          name: cat?.name ?? '?',
          budget: 0,
          spent: Math.round(spent * 100) / 100,
          difference: Math.round(-spent * 100) / 100,
        });
      }
    }

    const totalSpent = Math.round([...spentByCategory.values()].reduce((s, v) => s + v, 0) * 100) / 100;

    return NextResponse.json({
      month: monthParam,
      expenses: txns ?? [],
      summary: summaryRows,
      totalSpent,
      cardGoal: goalRow?.card_goal ? Number(goalRow.card_goal) : null,
      categories: categories ?? [],
    });
  } catch (error) {
    console.error('Expenses GET error:', error);
    return NextResponse.json({ error: 'Failed to load expenses' }, { status: 500 });
  }
}