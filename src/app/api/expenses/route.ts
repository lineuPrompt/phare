import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { recurrenceDates } from '@/lib/dateHelpers';
import { logEvent, isFirstEvent } from '@/lib/eventLogger';

// POST: create expense (single, monthly recurring, or installments).
// The only remaining consumer of this route — GET (per-account month view)
// was removed with the Expenses page; the raw transaction list now lives on
// Audit (/api/reconcile), read-only.
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
      member_id: string | null;
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

    // Expenses are household-level, not personal — same rule save-plan's
    // onboarding path already follows for fixed expenses (member_id null).
    // Income keeps the creator's own member attribution, unchanged.
    const resolvedMemberId = type === 'expense' ? null : member.id;

    if (repeat === 'monthly') {
      const recurrenceId = crypto.randomUUID();
      recurrenceDates(date, 12).forEach((d) => {
        rows.push({
          household_id: householdId, member_id: resolvedMemberId, category_id: categoryId || null,
          amount, description, date: d, type, source: 'manual',
          recurrence_id: recurrenceId, installment_label: null, account_id: resolvedAccountId,
        });
      });
    } else if (repeat === 'installments' && installments > 1) {
      const recurrenceId = crypto.randomUUID();
      recurrenceDates(date, installments).forEach((d, i) => {
        rows.push({
          household_id: householdId, member_id: resolvedMemberId, category_id: categoryId || null,
          amount, description, date: d, type, source: 'manual',
          recurrence_id: recurrenceId, installment_label: `${i + 1}/${installments}`, account_id: resolvedAccountId,
        });
      });
    } else {
      rows.push({
        household_id: householdId, member_id: resolvedMemberId, category_id: categoryId || null,
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
