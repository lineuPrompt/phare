import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { recurrenceDates } from '@phare/core';
import { logEvent, isFirstEvent } from '@/lib/eventLogger';
import { parseExpenseRequest, type ExpenseErrorCode } from '@/lib/expenseRequest';

// POST: create expense (single, monthly recurring, or installments).
// The only remaining consumer of this route — GET (per-account month view)
// was removed with the Expenses page; the raw transaction list now lives on
// Audit (/api/reconcile), read-only. Callers: the web ExpenseForm and
// TimelineEntryForm, and the mobile quick-entry screen.
//
// Every refusal is { code, error }. See lib/expenseRequest.ts for the body
// rules; ownership of the account and category is checked here, because it
// needs the database.

function fail(code: ExpenseErrorCode, error: string, status: number) {
  return NextResponse.json({ code, error }, { status });
}

export async function POST(request: Request) {
  try {
    const parsed = parseExpenseRequest(await request.text());
    if (!parsed.ok) {
      const { code, error, status } = parsed.refusal;
      return fail(code, error, status);
    }
    const { type, date, description, amount, categoryId, accountId, repeat, installments } = parsed.value;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail('NOT_AUTHENTICATED', 'Not authenticated', 401);

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();
    if (!userRow?.household_id) {
      return fail('NO_HOUSEHOLD', 'No household', 400);
    }
    const householdId = userRow.household_id;

    const { data: member } = await supabase
      .from('household_members')
      .select('id')
      .eq('household_id', householdId)
      .eq('user_id', user.id)
      .single();
    if (!member) return fail('NO_MEMBER', 'No member record', 400);

    // OWNERSHIP. The transactions insert policy checks household_id and
    // nothing else, so an account_id or category_id from another household
    // would be written onto this household's row (docs/tickets — cross-
    // household account_id). Each id sent is looked up scoped to the
    // caller's household; a miss is refused, a lookup error is reported as
    // one rather than dressed up as "not found".
    if (accountId) {
      const { data: account, error } = await supabase
        .from('accounts')
        .select('id')
        .eq('id', accountId)
        .eq('household_id', householdId)
        .maybeSingle();
      if (error) {
        console.error('Expense account lookup error:', error);
        return fail('LOOKUP_FAILED', 'Could not check the account', 500);
      }
      if (!account) return fail('ACCOUNT_NOT_FOUND', 'That account does not belong to this household.', 400);
    }
    if (categoryId) {
      const { data: category, error } = await supabase
        .from('categories')
        .select('id')
        .eq('id', categoryId)
        .eq('household_id', householdId)
        .maybeSingle();
      if (error) {
        console.error('Expense category lookup error:', error);
        return fail('LOOKUP_FAILED', 'Could not check the category', 500);
      }
      if (!category) return fail('CATEGORY_NOT_FOUND', 'That category does not belong to this household.', 400);
    }

    // Resolve account — fall back to chequing when caller omits it
    let resolvedAccountId: string;
    if (accountId) {
      resolvedAccountId = accountId;
    } else {
      const { data: chequing } = await supabase
        .from('accounts')
        .select('id')
        .eq('household_id', householdId)
        .eq('type', 'chequing')
        .single();
      if (!chequing) return fail('NO_CHEQUING', 'No chequing account found', 400);
      resolvedAccountId = chequing.id as string;
    }

    type Row = {
      household_id: string;
      member_id: string | null;
      category_id: string | null;
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
          household_id: householdId, member_id: resolvedMemberId, category_id: categoryId,
          amount, description, date: d, type, source: 'manual',
          recurrence_id: recurrenceId, installment_label: null, account_id: resolvedAccountId,
        });
      });
    } else if (repeat === 'installments' && installments !== null) {
      const recurrenceId = crypto.randomUUID();
      recurrenceDates(date, installments).forEach((d, i) => {
        rows.push({
          household_id: householdId, member_id: resolvedMemberId, category_id: categoryId,
          amount, description, date: d, type, source: 'manual',
          recurrence_id: recurrenceId, installment_label: `${i + 1}/${installments}`, account_id: resolvedAccountId,
        });
      });
    } else {
      rows.push({
        household_id: householdId, member_id: resolvedMemberId, category_id: categoryId,
        amount, description, date, type, source: 'manual',
        recurrence_id: null, installment_label: null, account_id: resolvedAccountId,
      });
    }

    const { error: insertError } = await supabase.from('transactions').insert(rows);
    if (insertError) {
      console.error('Insert error:', insertError);
      return fail('SAVE_FAILED', 'Failed to save expense', 500);
    }

    // Log created_first_expense the first time this household enters a transaction manually.
    if (await isFirstEvent(supabase, householdId, 'created_first_expense')) {
      await logEvent(supabase, householdId, user.id, 'created_first_expense', { type });
    }

    return NextResponse.json({ saved: true, count: rows.length });
  } catch (error) {
    console.error('Expense error:', error);
    return fail('SAVE_FAILED', 'Failed to save expense', 500);
  }
}
