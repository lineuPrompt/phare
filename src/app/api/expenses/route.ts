import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { recurrenceDates } from '@/lib/dateHelpers';
import { logEvent, isFirstEvent } from '@/lib/eventLogger';
import { GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { ensureBridgesForWindow } from '@/lib/bridgeHelpers';

// POST: create expense (single, monthly recurring, or installments)
export async function POST(request: Request) {
  try {
    const { date, description, categoryId, amount, repeat, installments, accountId, type = 'expense' } = await request.json();

    if (!['income', 'expense'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }
    if (!date || !description || !amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (type === 'expense' && !categoryId) {
      return NextResponse.json({ error: 'Category required for expenses' }, { status: 400 });
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

    const { data: member } = await supabase
      .from('household_members')
      .select('id')
      .eq('household_id', householdId)
      .eq('user_id', user.id)
      .single();
    if (!member) return NextResponse.json({ error: 'No member record' }, { status: 400 });

    // Resolve account — fall back to chequing when caller omits it
    let resolvedAccountId: string = accountId;
    if (!resolvedAccountId) {
      const { data: chequing } = await supabase
        .from('accounts')
        .select('id')
        .eq('household_id', householdId)
        .eq('type', 'chequing')
        .single();
      if (!chequing) return NextResponse.json({ error: 'No chequing account found' }, { status: 400 });
      resolvedAccountId = chequing.id;
    }

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
      account_id: string;
    };

    const rows: Row[] = [];

    if (repeat === 'monthly') {
      const recurrenceId = crypto.randomUUID();
      recurrenceDates(date, 12).forEach((d) => {
        rows.push({
          household_id: householdId, member_id: member.id, category_id: categoryId || null,
          amount, description, date: d, type, source: 'manual',
          recurrence_id: recurrenceId, installment_label: null, account_id: resolvedAccountId,
        });
      });
    } else if (repeat === 'installments' && installments > 1) {
      const recurrenceId = crypto.randomUUID();
      recurrenceDates(date, installments).forEach((d, i) => {
        rows.push({
          household_id: householdId, member_id: member.id, category_id: categoryId || null,
          amount, description, date: d, type, source: 'manual',
          recurrence_id: recurrenceId, installment_label: `${i + 1}/${installments}`, account_id: resolvedAccountId,
        });
      });
    } else {
      rows.push({
        household_id: householdId, member_id: member.id, category_id: categoryId || null,
        amount, description, date, type, source: 'manual',
        recurrence_id: null, installment_label: null, account_id: resolvedAccountId,
      });
    }

    const { error: insertError } = await supabase.from('transactions').insert(rows);
    if (insertError) {
      console.error('Insert error:', insertError);
      return NextResponse.json({ error: 'Failed to save expense' }, { status: 500 });
    }

    // Log created_first_expense the first time this household enters a transaction manually.
    if (await isFirstEvent(supabase, householdId, 'created_first_expense')) {
      await logEvent(supabase, householdId, user.id, 'created_first_expense', { type });
    }

    return NextResponse.json({ saved: true, count: rows.length });
  } catch (error) {
    console.error('Expense error:', error);
    return NextResponse.json({ error: 'Failed to save expense' }, { status: 500 });
  }
}

// GET: per-account expenses + summary for a month (?month=2026-06&account=<id>)
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month');
    const accountParam = url.searchParams.get('account');
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    const { data: { user: u2 } } = await supabase.auth.getUser();
    const { data: memberRow } = await supabase
      .from('household_members').select('id').eq('household_id', householdId).eq('user_id', u2?.id).single();
    const memberId = memberRow?.id ?? null;

    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name, type, payment_day')
      .eq('household_id', householdId)
      .order('type', { ascending: true })
      .order('name', { ascending: true });

    // Goal accounts (savings/tfsa/rrsp) are not spending accounts — they never
    // appear as expense tabs and never accept logged expenses.
    const accountList = (accounts ?? []).filter(
      (a) => !(GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type)
    );
    const selectedAccount =
      accountList.find((a) => a.id === accountParam) ??
      accountList.find((a) => a.type === 'chequing') ??
      accountList[0] ??
      null;

    const monthStart = `${monthParam}-01`;
    const [y, m] = monthParam.split('-').map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // ----- BRIDGE: when viewing chequing, ensure prior-month card totals
    // exist as payment lines this month -----
    if (selectedAccount?.type === 'chequing') {
      const prevMonthIndex = (m - 1) - 1;
      const prevYear = y + Math.floor(prevMonthIndex / 12);
      const prevMonth0 = ((prevMonthIndex % 12) + 12) % 12;
      const prevMonth = `${prevYear}-${String(prevMonth0 + 1).padStart(2, '0')}`;

      const cards = accountList
        .filter((a) => a.type === 'credit_card')
        .map((a) => ({ id: a.id, name: a.name, payment_day: (a.payment_day ?? null) as number | null }));

      await ensureBridgesForWindow({
        supabase,
        householdId,
        chequingId: selectedAccount.id,
        memberId,
        cards,
        spendMonths: [prevMonth],
      });
    }

    let txnQuery = supabase
      .from('transactions')
      .select('id, date, description, amount, type, account_id, is_bridge, installment_label, recurrence_id, category_id, categories(name), household_members(name)')
      .eq('household_id', householdId)
      .gte('date', monthStart)
      .lt('date', nextMonth)
      .order('date', { ascending: true });

    if (selectedAccount) {
      txnQuery = txnQuery.eq('account_id', selectedAccount.id);
    }
    const { data: allTxns } = await txnQuery;

    const txns = (allTxns ?? []).filter((t) => t.type === 'expense');
    const incomeTxns = (allTxns ?? []).filter((t) => t.type === 'income');
    const totalIncome = Math.round(incomeTxns.reduce((s, t) => s + Number(t.amount), 0) * 100) / 100;

    // Recurring items on THIS account with no known pay date yet — the same
    // notice the dashboard shows, scoped to the account being viewed here.
    let unanchoredIncomeCount = 0;
    let unanchoredExpenseCount = 0;
    if (selectedAccount) {
      const [{ count: uInc }, { count: uExp }] = await Promise.all([
        supabase
          .from('recurring_items')
          .select('id', { count: 'exact', head: true })
          .eq('household_id', householdId)
          .eq('account_id', selectedAccount.id)
          .eq('type', 'income')
          .eq('active', true)
          .is('anchor_date', null),
        supabase
          .from('recurring_items')
          .select('id', { count: 'exact', head: true })
          .eq('household_id', householdId)
          .eq('account_id', selectedAccount.id)
          .eq('type', 'expense')
          .eq('active', true)
          .is('anchor_date', null),
      ]);
      unanchoredIncomeCount = uInc ?? 0;
      unanchoredExpenseCount = uExp ?? 0;
    }

    const { data: categories } = await supabase
      .from('categories')
      .select('id, name, type')
      .eq('household_id', householdId)
      .eq('type', 'expense')
      .order('name');

    // Budget source: card_envelope_items for card/LOC accounts; general budgets table for chequing.
    const isCard = selectedAccount?.type === 'credit_card' || selectedAccount?.type === 'line_of_credit';
    type BudgetRow = { amount: number; category_id: string; categories: { name: string; type: string } | null };
    let budgetItems: BudgetRow[] = [];

    if (isCard && selectedAccount) {
      const { data: envItems } = await supabase
        .from('card_envelope_items')
        .select('monthly_amount, category_id, categories(name, type)')
        .eq('household_id', householdId)
        .eq('account_id', selectedAccount.id);
      budgetItems = (envItems ?? []).map((d) => ({
        amount: Number(d.monthly_amount),
        category_id: d.category_id as string,
        categories: d.categories as unknown as { name: string; type: string } | null,
      }));
    } else {
      const { data: budgets } = await supabase
        .from('budgets')
        .select('amount, category_id, categories(name, type)')
        .eq('household_id', householdId)
        .eq('month', monthStart);
      budgetItems = (budgets ?? []).map((d) => ({
        amount: Number(d.amount),
        category_id: d.category_id as string,
        categories: d.categories as unknown as { name: string; type: string } | null,
      }));
    }

    // Card goal: per-card (carry-forward); chequing has no goal.
    let goalRow: { card_goal: number } | null = null;
    if (isCard && selectedAccount) {
      const { data } = await supabase
        .from('monthly_goals')
        .select('card_goal')
        .eq('household_id', householdId)
        .eq('account_id', selectedAccount.id)
        .lte('month', monthStart)
        .order('month', { ascending: false })
        .limit(1)
        .maybeSingle();
      goalRow = data;
    }

    type Txn = { amount: number; category_id: string | null; is_bridge?: boolean };

    // Bridge lines don't belong to a spending category — exclude from category rollup
    const spentByCategory = new Map<string, number>();
    for (const t of (txns as Txn[] | null) ?? []) {
      if (!t.category_id || t.is_bridge) continue;
      spentByCategory.set(t.category_id, (spentByCategory.get(t.category_id) ?? 0) + Number(t.amount));
    }

    const summaryRows = budgetItems
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

    // totalSpent for chequing should include bridge lines (real money out);
    // for cards it's category spending. Compute from the actual expense txns.
    const totalSpent = Math.round(
      (txns as { amount: number }[]).reduce((s, t) => s + Number(t.amount), 0) * 100
    ) / 100;

    return NextResponse.json({
      month: monthParam,
      accounts: accountList,
      selectedAccount,
      expenses: txns,
      income: incomeTxns,
      totalIncome,
      summary: summaryRows,
      totalSpent,
      net: Math.round((totalIncome - totalSpent) * 100) / 100,
      cardGoal: goalRow?.card_goal ? Number(goalRow.card_goal) : null,
      categories: categories ?? [],
      unanchoredIncomeCount,
      unanchoredExpenseCount,
    });
  } catch (error) {
    console.error('Expenses GET error:', error);
    return NextResponse.json({ error: 'Failed to load expenses' }, { status: 500 });
  }
}