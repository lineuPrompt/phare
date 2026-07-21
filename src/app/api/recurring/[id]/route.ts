import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { businessToday, materializeFromMonthStart } from '@/lib/dateHelpers';
import { GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

/**
 * PATCH: full edit of a recurring rule.
 *
 * Accepts all editable fields: description, amount, cadence, anchorDate,
 * secondDay, categoryId, accountId, destinationAccountId (transfer only).
 * Any omitted field defaults to its current value (loaded from DB before
 * the update). A rule's `type` itself is never editable — the source/goal
 * shape differs enough (category vs. destination account) that changing
 * type would need to reconstruct half the row; delete and recreate instead.
 *
 * Re-materialization strategy (idempotent, no-duplicate):
 *   1. Delete all this-month-onward linked rows (WHERE recurring_item_id = id
 *      AND date >= start of the current month). Keyed by recurring_item_id —
 *      for a transfer rule this removes BOTH sides of every future pair in
 *      one statement, since create_transfer tags recurring_item_id on both.
 *   2. materializeFromMonthStart with the NEW cadence params — the current
 *      month is regenerated in full under the new rule, not just its
 *      not-yet-occurred remainder.
 *   3. Insert fresh rows (income/expense) or call create_transfer once per
 *      date (transfer) with new description/amount/category/account values.
 *
 * Rows before the current month (date < start of this month) are untouched
 * as history.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // Load current rule (needed to fall back to existing values for omitted fields)
    const { data: current, error: loadErr } = await supabase
      .from('recurring_items')
      .select('id, household_id, member_id, description, amount, type, cadence, anchor_date, second_day, category_id, account_id, destination_account_id')
      .eq('id', id)
      .eq('household_id', householdId)
      .single();

    if (loadErr || !current) {
      return NextResponse.json({ error: 'Recurring item not found' }, { status: 404 });
    }

    const isTransfer = current.type === 'transfer';

    // Merge incoming fields with current values (any field absent in body keeps its current value)
    const newDescription = typeof body.description === 'string' ? body.description.trim() : current.description;
    const newAmount      = body.amount   != null ? Number(body.amount)   : Number(current.amount);
    const newCadence     = body.cadence  ?? current.cadence;
    const newAnchorDate  = body.anchorDate ?? current.anchor_date;
    const newSecondDay   = body.secondDay  !== undefined ? (body.secondDay ?? null) : current.second_day;
    const newCategoryId  = body.categoryId !== undefined ? (body.categoryId || null) : current.category_id;
    // A transfer's source account is always chequing, resolved at creation —
    // never user-editable here regardless of what the body sends.
    const newAccountId   = isTransfer ? current.account_id : (body.accountId ?? current.account_id);
    const newDestinationId = isTransfer
      ? (body.destinationAccountId !== undefined ? body.destinationAccountId : current.destination_account_id)
      : current.destination_account_id;
    // memberId is explicitly nullable (household-level attribution) — only
    // fall back to the current value when the field is entirely absent from
    // the request body, never when it was sent as null on purpose.
    const newMemberId    = 'memberId' in body ? (body.memberId ?? null) : current.member_id;

    if (!['monthly', 'biweekly', 'semimonthly', 'weekly'].includes(newCadence)) {
      return NextResponse.json({ error: 'Invalid cadence' }, { status: 400 });
    }
    if (!newDescription) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }
    if (!newAmount || newAmount <= 0 || isNaN(newAmount)) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
    }
    if (current.type === 'expense' && !newCategoryId) {
      return NextResponse.json({ error: 'Category required for expense recurring items' }, { status: 400 });
    }
    if (isTransfer && !newDestinationId) {
      return NextResponse.json({ error: 'Destination goal account required for a recurring transfer' }, { status: 400 });
    }

    if (isTransfer) {
      // Verify the (possibly new) destination is a goal account in this household.
      const { data: goalAccount } = await supabase
        .from('accounts')
        .select('id, type')
        .eq('id', newDestinationId)
        .eq('household_id', householdId)
        .single();
      if (!goalAccount || !(GOAL_ACCOUNT_TYPES as readonly string[]).includes(goalAccount.type)) {
        return NextResponse.json({ error: 'Invalid destination goal account' }, { status: 400 });
      }
    } else {
      // Verify account belongs to this household
      const { data: account } = await supabase
        .from('accounts')
        .select('id')
        .eq('id', newAccountId)
        .eq('household_id', householdId)
        .single();
      if (!account) {
        return NextResponse.json({ error: 'Invalid account' }, { status: 400 });
      }
    }

    // Verify the reassigned member (if any) belongs to this household —
    // null is always valid (household-level attribution).
    if (newMemberId !== null) {
      const { data: memberRow } = await supabase
        .from('household_members')
        .select('id')
        .eq('id', newMemberId)
        .eq('household_id', householdId)
        .single();
      if (!memberRow) {
        return NextResponse.json({ error: 'Invalid member' }, { status: 400 });
      }
    }

    // 1. Update the rule
    const { data: updatedItem, error: ruleErr } = await supabase
      .from('recurring_items')
      .update({
        description: newDescription,
        amount:      newAmount,
        cadence:     newCadence,
        anchor_date: newAnchorDate,
        second_day:  newSecondDay,
        category_id: newCategoryId,
        account_id:  newAccountId,
        destination_account_id: newDestinationId,
        member_id:   newMemberId,
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('id, member_id, type')
      .single();

    if (ruleErr || !updatedItem) {
      console.error('Recurring PATCH rule error:', ruleErr);
      return NextResponse.json({ error: ruleErr?.message ?? 'Update failed' }, { status: 500 });
    }

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const todayStr = businessToday(timezone);
    const monthStartStr = `${todayStr.slice(0, 7)}-01`;

    // 2. Delete all this-month-onward linked rows (keyed by recurring_item_id
    // — no orphan risk; for a transfer this removes both sides of every
    // future pair in one statement). Month start, not today: the whole
    // current month is regenerated under the new rule, not just its
    // not-yet-occurred remainder.
    const { error: deleteErr } = await supabase
      .from('transactions')
      .delete()
      .eq('household_id', householdId)
      .eq('recurring_item_id', id)
      .gte('date', monthStartStr);

    if (deleteErr) {
      console.error('Recurring PATCH txn cleanup error:', deleteErr);
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    // 3. Re-materialize — only when there's a known anchor date. No anchor
    // yet means no dated instances, not a fabricated guess.
    const canMaterialize = !!newAnchorDate;
    const dates = canMaterialize
      ? materializeFromMonthStart(
          { cadence: newCadence as 'monthly' | 'biweekly' | 'semimonthly' | 'weekly', anchorDate: newAnchorDate, secondDay: newSecondDay },
          todayStr,
          12
        )
      : [];

    if (isTransfer) {
      let materialized = 0;
      for (const date of dates) {
        const { error: rpcErr } = await supabase.rpc('create_transfer', {
          p_household_id: householdId,
          p_member_id: updatedItem.member_id,
          p_chequing_id: newAccountId,
          p_goal_id: newDestinationId,
          p_amount: newAmount,
          p_date: date,
          p_description: newDescription,
          p_recurring_item_id: id,
        });
        if (rpcErr) {
          console.error('Recurring transfer re-materialization RPC error:', rpcErr);
          return NextResponse.json({ error: rpcErr.message || 'Rule updated but re-materialization failed partway through', updated: true, materialized }, { status: 500 });
        }
        materialized += 1;
      }
      return NextResponse.json({ updated: true, materialized });
    }

    // 4. Insert fresh rows with new field values
    if (dates.length) {
      const rows = dates.map((date) => ({
        household_id:      householdId,
        member_id:         updatedItem.member_id,
        category_id:       newCategoryId,
        account_id:        newAccountId,
        amount:            newAmount,
        description:       newDescription,
        date,
        type:              updatedItem.type,
        source:            'manual',
        recurring_item_id: id,
      }));

      const { error: insertErr } = await supabase.from('transactions').insert(rows);
      if (insertErr) {
        console.error('Recurring PATCH txn insert error:', insertErr);
        return NextResponse.json({ error: insertErr.message }, { status: 500 });
      }
    }

    return NextResponse.json({ updated: true, materialized: dates.length });
  } catch (error) {
    console.error('Recurring PATCH threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE: remove a recurring rule + its future materialized rows (past kept
// as history). For a transfer rule this removes BOTH sides of every future
// pair atomically — a single DELETE ... WHERE recurring_item_id = id matches
// every row create_transfer tagged on either side of each pair.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const todayStr = businessToday(timezone);

    await supabase
      .from('transactions')
      .delete()
      .eq('household_id', householdId)
      .eq('recurring_item_id', id)
      .gte('date', todayStr);

    const { error } = await supabase
      .from('recurring_items')
      .delete()
      .eq('id', id)
      .eq('household_id', householdId);

    if (error) {
      console.error('Recurring delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Recurring DELETE threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
