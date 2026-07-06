import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { formatLocalDate, materializeFutureRule } from '@/lib/dateHelpers';

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
 * secondDay, categoryId, accountId.  Any omitted field defaults to its
 * current value (loaded from DB before the update).
 *
 * Re-materialization strategy (idempotent, no-duplicate):
 *   1. Delete all future linked rows (WHERE recurring_item_id = id AND date >= today).
 *      Keyed by recurring_item_id, so exactly the linked set is removed.
 *   2. materializeFutureRule with the NEW cadence params.
 *   3. Insert fresh rows with new description/amount/category/account.
 *
 * Past rows (date < today) are untouched as history.
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
      .select('id, household_id, member_id, description, amount, type, cadence, anchor_date, second_day, category_id, account_id')
      .eq('id', id)
      .eq('household_id', householdId)
      .single();

    if (loadErr || !current) {
      return NextResponse.json({ error: 'Recurring item not found' }, { status: 404 });
    }

    // Merge incoming fields with current values (any field absent in body keeps its current value)
    const newDescription = typeof body.description === 'string' ? body.description.trim() : current.description;
    const newAmount      = body.amount   != null ? Number(body.amount)   : Number(current.amount);
    const newCadence     = body.cadence  ?? current.cadence;
    const newAnchorDate  = body.anchorDate ?? current.anchor_date;
    const newSecondDay   = body.secondDay  !== undefined ? (body.secondDay ?? null) : current.second_day;
    const newCategoryId  = body.categoryId !== undefined ? (body.categoryId || null) : current.category_id;
    const newAccountId   = body.accountId  ?? current.account_id;

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
      })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('id, member_id, type')
      .single();

    if (ruleErr || !updatedItem) {
      console.error('Recurring PATCH rule error:', ruleErr);
      return NextResponse.json({ error: ruleErr?.message ?? 'Update failed' }, { status: 500 });
    }

    const todayStr = formatLocalDate(new Date());

    // 2. Delete all future linked rows (keyed by recurring_item_id — no orphan risk)
    const { error: deleteErr } = await supabase
      .from('transactions')
      .delete()
      .eq('household_id', householdId)
      .eq('recurring_item_id', id)
      .gte('date', todayStr);

    if (deleteErr) {
      console.error('Recurring PATCH txn cleanup error:', deleteErr);
      return NextResponse.json({ error: deleteErr.message }, { status: 500 });
    }

    // 3. Re-materialize — only when there's a known anchor date. No anchor
    // yet means no dated instances, not a fabricated guess.
    const canMaterialize = !!newAnchorDate;
    const dates = canMaterialize
      ? materializeFutureRule(
          { cadence: newCadence as 'monthly' | 'biweekly' | 'semimonthly' | 'weekly', anchorDate: newAnchorDate, secondDay: newSecondDay },
          todayStr,
          12
        )
      : [];

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

// DELETE: remove a recurring rule + its future materialized rows (past kept as history)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const todayStr = formatLocalDate(new Date());

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
