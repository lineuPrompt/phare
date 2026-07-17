import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { computeGoalBalance, GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

// PATCH: update a card's statement_close_day/payment_day, or a goal's name /
// target amount / target date (both clearable — "no target" is a valid
// state) / debt amount owed.
//
// A debt's amount owed is corrected via a NEW transaction row (the delta
// between the desired balance and today's actual balance), never by
// mutating the original opening-balance row — the ledger stays
// append-honest, same principle as everywhere else money moves in this app.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { statementCloseDay, paymentDay, name, goalTarget, goalTargetDate, newAmountOwed } = body;

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: current } = await supabase
      .from('accounts')
      .select('id, type')
      .eq('id', id)
      .eq('household_id', householdId)
      .single();
    if (!current) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    // Validate day values when provided
    const toDay = (v: unknown) => {
      if (v === null || v === undefined) return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1 || n > 31) return 'invalid';
      return n;
    };

    const closeDay = toDay(statementCloseDay);
    const payDay   = toDay(paymentDay);
    if (closeDay === 'invalid' || payDay === 'invalid') {
      return NextResponse.json({ error: 'Day must be between 1 and 31' }, { status: 400 });
    }

    if (name !== undefined && !String(name).trim()) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
    }

    const updates: Record<string, number | string | null> = {};
    if (closeDay !== undefined) updates.statement_close_day = closeDay as number;
    if (payDay   !== undefined) updates.payment_day         = payDay   as number;
    if (name !== undefined) updates.name = String(name).trim();
    // Clearable: goalTarget/goalTargetDate explicitly sent as null clears
    // them ("no target" is a valid state) — only an entirely absent field
    // leaves the current value untouched.
    if ('goalTarget' in body) {
      if (goalTarget !== null && (typeof goalTarget !== 'number' || goalTarget < 0)) {
        return NextResponse.json({ error: 'Target amount must be a positive number or null' }, { status: 400 });
      }
      updates.goal_target = goalTarget;
    }
    if ('goalTargetDate' in body) {
      updates.goal_target_date = goalTargetDate;
    }

    // Debt correction: insert a new transaction for the delta between the
    // desired balance and today's actual (today-cutoff) balance — never
    // mutate the opening row. Only meaningful for a debt account.
    let correctionAmount: number | null = null;
    if (newAmountOwed !== undefined && newAmountOwed !== null) {
      if (current.type !== 'debt') {
        return NextResponse.json({ error: 'Amount owed only applies to a debt account' }, { status: 400 });
      }
      const desiredOwed = Number(newAmountOwed);
      if (!Number.isFinite(desiredOwed) || desiredOwed < 0) {
        return NextResponse.json({ error: 'Amount owed must be a non-negative number' }, { status: 400 });
      }
      const today = new Date().toISOString().slice(0, 10);
      const { data: allTxns } = await supabase
        .from('transactions')
        .select('amount, type, account_id, date')
        .eq('household_id', householdId)
        .eq('account_id', id);
      const currentBalance = computeGoalBalance(
        (allTxns ?? []) as { amount: number | string; type: string; account_id: string | null; date?: string }[],
        id,
        today
      );
      const desiredBalance = -Math.abs(desiredOwed); // debt balance is always <= 0
      correctionAmount = Math.round((desiredBalance - currentBalance) * 100) / 100;
    }

    if (Object.keys(updates).length === 0 && correctionAmount === null) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    if (correctionAmount !== null && correctionAmount !== 0) {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: member } = await supabase
        .from('household_members').select('id')
        .eq('household_id', householdId).eq('user_id', user?.id ?? '').single();

      const { error: correctionErr } = await supabase.from('transactions').insert({
        household_id: householdId,
        member_id: member?.id ?? null,
        category_id: null,
        description: 'Balance correction',
        amount: correctionAmount,
        date: new Date().toISOString().slice(0, 10),
        type: 'transfer',
        source: 'manual',
        account_id: id,
      });
      if (correctionErr) {
        console.error('Debt correction insert error:', correctionErr);
        return NextResponse.json({ error: correctionErr.message }, { status: 500 });
      }
    }

    let account = current;
    if (Object.keys(updates).length > 0) {
      const { data: updated, error } = await supabase
        .from('accounts')
        .update(updates)
        .eq('id', id)
        .eq('household_id', householdId)
        .select('id, name, type, statement_close_day, payment_day, goal_target, goal_target_date')
        .single();

      if (error) {
        console.error('Account PATCH error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!updated) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
      account = updated;
    }

    return NextResponse.json({ account });
  } catch (error) {
    console.error('Account PATCH threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE: remove an account. Chequing cannot be deleted (it's the base
// account). A goal/debt account routes through delete_goal_account (RPC) —
// honest consequences (relabel past chequing history, cancel future
// transfers + the recurring rule) instead of the generic block-if-has-
// transactions guard below, which every goal would otherwise always hit.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: account } = await supabase
      .from('accounts')
      .select('type')
      .eq('id', id)
      .eq('household_id', householdId)
      .single();

    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (account.type === 'chequing') {
      return NextResponse.json({ error: 'Cannot delete the chequing account' }, { status: 400 });
    }

    if ((GOAL_ACCOUNT_TYPES as readonly string[]).includes(account.type)) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: result, error: rpcErr } = await supabase.rpc('delete_goal_account', {
        p_household_id: householdId,
        p_goal_id: id,
        p_today: today,
      });
      if (rpcErr) {
        console.error('delete_goal_account RPC error:', rpcErr);
        return NextResponse.json({ error: rpcErr.message || 'Failed to delete goal' }, { status: 500 });
      }
      return NextResponse.json({ deleted: true, ...result });
    }

    // Block deletion when transactions exist — account_id is NOT NULL in the DB
    const { count } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id);
    if (count && count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete an account that has transactions. Remove all transactions first.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('id', id)
      .eq('household_id', householdId);

    if (error) {
      console.error('Account delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Account DELETE threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
