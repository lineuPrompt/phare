import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { businessToday, materializeFromMonthStart, excludeSkippedDates, firstOfNextMonth } from '@/lib/dateHelpers';
import { GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

type Cadence = 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';

/**
 * PATCH: full edit of a recurring rule.
 *
 * Accepts all editable fields: description, amount, cadence, anchorDate,
 * secondDay, categoryId, accountId, destinationAccountId (transfer only),
 * memberId, and effectiveFrom (only consulted on the split path below). A
 * rule's `type` itself is never editable — the source/goal shape differs
 * enough (category vs. destination account) that changing type would need
 * to reconstruct half the row; delete and recreate instead.
 *
 * Two distinct update paths, chosen by what actually changed (Timeline Part
 * B, split-into-two-rules model, founder-approved 2026-07-21):
 *
 *  METADATA PATH (description/category/account/member only — amount,
 *  cadence, anchorDate, secondDay all unchanged): mutates the rule row in
 *  place, exactly as before. Re-materializes this-month-onward rows so the
 *  corrected description/category/member flows into already-materialized
 *  current+future occurrences (a name/category fix isn't a "value with an
 *  effective date" the way an amount or cadence is — see the file's "Out of
 *  scope" note in the Part B spec).
 *
 *  SPLIT PATH (amount, cadence, anchorDate, or secondDay changed, AND the
 *  rule has a real anchor already — i.e. it has actually been materializing):
 *  the current row is frozen (active=false, a pre-existing flag dashboard/
 *  goals queries already filter on) and every one of ITS transaction rows
 *  dated >= effectiveFrom is deleted (superseded — either not yet
 *  materialized past the boundary, or materialized under the old value and
 *  about to be replaced). A NEW recurring_items row takes over from
 *  effectiveFrom forward, carrying the new amount/cadence/anchor/secondDay
 *  plus whatever else was in this same request. Rows dated < effectiveFrom
 *  are never touched by either step — real history, regardless of whether
 *  they're in a past month or still earlier this month. This is what fixes
 *  the pre-existing bug where editing a rule mid-month silently rewrote
 *  already-happened days in the current month too (the old code's boundary
 *  was "start of this month," not "the date the household actually chose").
 *
 *  A rule with no anchor yet (needsPayDate) always takes the metadata path
 *  even if amount/cadence change — nothing has materialized yet, so there's
 *  no history to preserve; splitting would just be bookkeeping overhead.
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
      .select('id, household_id, member_id, description, amount, type, cadence, anchor_date, second_day, category_id, account_id, destination_account_id, active')
      .eq('id', id)
      .eq('household_id', householdId)
      .single();

    if (loadErr || !current) {
      return NextResponse.json({ error: 'Recurring item not found' }, { status: 404 });
    }
    if (current.active === false) {
      return NextResponse.json({ error: 'This rule has been superseded by a later change and is frozen as history — it can no longer be edited.' }, { status: 400 });
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

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const todayStr = businessToday(timezone);

    const valueChanged =
      Number(newAmount) !== Number(current.amount) ||
      newCadence !== current.cadence ||
      newAnchorDate !== current.anchor_date ||
      (newSecondDay ?? null) !== (current.second_day ?? null);

    if (valueChanged && current.anchor_date !== null) {
      return await splitRule({
        supabase, householdId, oldRuleId: id, todayStr, body,
        newDescription, newAmount, newCadence: newCadence as Cadence, newAnchorDate, newSecondDay,
        newCategoryId, newAccountId, newDestinationId, newMemberId,
        type: current.type as 'income' | 'expense' | 'transfer',
      });
    }

    // ── METADATA PATH — in-place edit, unchanged from before ─────────────────

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

    const monthStartStr = `${todayStr.slice(0, 7)}-01`;

    // Delete all this-month-onward linked rows (keyed by recurring_item_id —
    // no orphan risk; for a transfer this removes both sides of every future
    // pair in one statement). Month start, not today: the whole current
    // month is regenerated under the (metadata-only) new values, not just
    // its not-yet-occurred remainder — safe here because amount/cadence
    // never move on this path.
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

    // Re-materialize — only when there's a known anchor date. No anchor yet
    // means no dated instances, not a fabricated guess.
    const canMaterialize = !!newAnchorDate;
    const rawDates = canMaterialize
      ? materializeFromMonthStart(
          { cadence: newCadence as Cadence, anchorDate: newAnchorDate, secondDay: newSecondDay },
          todayStr,
          12
        )
      : [];

    // Never regenerate a date the household already detached from this rule
    // (Part A3: edited or deleted a single occurrence) — without this, this
    // very re-materialization step is exactly what would silently revert
    // that edit or resurrect that deletion.
    const { data: skippedRows } = rawDates.length
      ? await supabase
          .from('recurring_skipped_dates')
          .select('date')
          .eq('household_id', householdId)
          .eq('recurring_item_id', id)
      : { data: [] as { date: string }[] | null };
    const skippedDates = new Set((skippedRows ?? []).map((r) => r.date as string));
    const dates = excludeSkippedDates(rawDates, skippedDates);

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

/**
 * SPLIT PATH — see the PATCH docstring above for the full model. Isolated
 * into its own function purely for readability; not reused elsewhere.
 */
async function splitRule(args: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  householdId: string;
  oldRuleId: string;
  todayStr: string;
  body: Record<string, unknown>;
  newDescription: string;
  newAmount: number;
  newCadence: Cadence;
  newAnchorDate: string;
  newSecondDay: number | null;
  newCategoryId: string | null;
  newAccountId: string;
  newDestinationId: string | null;
  newMemberId: string | null;
  type: 'income' | 'expense' | 'transfer';
}) {
  const {
    supabase, householdId, oldRuleId, todayStr, body,
    newDescription, newAmount, newCadence, newAnchorDate, newSecondDay,
    newCategoryId, newAccountId, newDestinationId, newMemberId, type,
  } = args;
  const isTransfer = type === 'transfer';

  const requestedEffectiveFrom = typeof body.effectiveFrom === 'string' ? body.effectiveFrom : null;
  const effectiveFrom = requestedEffectiveFrom || firstOfNextMonth(todayStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    return NextResponse.json({ error: 'Invalid effective date' }, { status: 400 });
  }
  if (effectiveFrom < todayStr) {
    return NextResponse.json({ error: "Effective date can't be in the past — past occurrences keep their real value." }, { status: 400 });
  }

  // 1. Freeze the current rule as history — no further edits, no further
  // materialization from it. Its rows dated < effectiveFrom are left exactly
  // as they are (real history, whatever month they're in).
  const { error: freezeErr } = await supabase
    .from('recurring_items')
    .update({ active: false })
    .eq('id', oldRuleId)
    .eq('household_id', householdId);
  if (freezeErr) {
    console.error('Recurring PATCH (split) freeze error:', freezeErr);
    return NextResponse.json({ error: freezeErr.message }, { status: 500 });
  }

  // 2. Remove the old rule's rows from the boundary forward — they're
  // superseded by the new rule's materialization below (for a transfer this
  // removes both sides of every affected pair in one statement, same as the
  // metadata path).
  const { error: deleteErr } = await supabase
    .from('transactions')
    .delete()
    .eq('household_id', householdId)
    .eq('recurring_item_id', oldRuleId)
    .gte('date', effectiveFrom);
  if (deleteErr) {
    console.error('Recurring PATCH (split) txn cleanup error:', deleteErr);
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  // 3. Create the new rule, effective from the boundary forward.
  const { data: newRule, error: newRuleErr } = await supabase
    .from('recurring_items')
    .insert({
      household_id: householdId,
      member_id: newMemberId,
      category_id: isTransfer ? null : newCategoryId,
      account_id: newAccountId,
      destination_account_id: isTransfer ? newDestinationId : null,
      description: newDescription,
      amount: newAmount,
      type,
      cadence: newCadence,
      anchor_date: newAnchorDate,
      second_day: newSecondDay,
      active: true,
      effective_from: effectiveFrom,
      predecessor_id: oldRuleId,
    })
    .select('id')
    .single();
  if (newRuleErr || !newRule) {
    console.error('Recurring PATCH (split) new-rule insert error:', newRuleErr);
    return NextResponse.json({ error: newRuleErr?.message ?? 'Failed to create the new rule' }, { status: 500 });
  }

  // 4. Carry forward any tombstones dated on/after the boundary. Without
  // this, a household member who detached a single occurrence BEFORE the
  // split (Part A3) would see it silently duplicated the moment the new
  // rule's materialization below fills that same date back in — the exact
  // "detach and an effective-dated change must not conflict" case.
  const { data: carryRows } = await supabase
    .from('recurring_skipped_dates')
    .select('date')
    .eq('household_id', householdId)
    .eq('recurring_item_id', oldRuleId)
    .gte('date', effectiveFrom);
  if (carryRows && carryRows.length) {
    const { error: carryErr } = await supabase
      .from('recurring_skipped_dates')
      .insert(carryRows.map((r) => ({ household_id: householdId, recurring_item_id: newRule.id, date: r.date as string })));
    if (carryErr) {
      console.error('Recurring PATCH (split) tombstone carry-forward error (non-fatal):', carryErr);
    }
  }

  // 5. Materialize the new rule from the effective date forward. Filtering
  // to `>= effectiveFrom` handles a mid-cadence boundary sanely: cadence
  // math can produce a date earlier in the same month than the chosen
  // boundary (e.g. a biweekly anchor on the 1st with an effective date of
  // the 15th) — that earlier date belongs to the OLD rule's history, not
  // this new row, so it's dropped rather than duplicated.
  const rawDates = materializeFromMonthStart(
    { cadence: newCadence, anchorDate: newAnchorDate, secondDay: newSecondDay },
    effectiveFrom,
    12
  ).filter((d) => d >= effectiveFrom);

  const { data: skippedRows } = rawDates.length
    ? await supabase
        .from('recurring_skipped_dates')
        .select('date')
        .eq('household_id', householdId)
        .eq('recurring_item_id', newRule.id)
    : { data: [] as { date: string }[] | null };
  const dates = excludeSkippedDates(rawDates, new Set((skippedRows ?? []).map((r) => r.date as string)));

  if (isTransfer) {
    let materialized = 0;
    for (const date of dates) {
      const { error: rpcErr } = await supabase.rpc('create_transfer', {
        p_household_id: householdId,
        p_member_id: newMemberId,
        p_chequing_id: newAccountId,
        p_goal_id: newDestinationId,
        p_amount: newAmount,
        p_date: date,
        p_description: newDescription,
        p_recurring_item_id: newRule.id,
      });
      if (rpcErr) {
        console.error('Recurring PATCH (split) transfer materialization RPC error:', rpcErr);
        return NextResponse.json(
          { error: rpcErr.message || 'Rule split but new-rule materialization failed partway through', updated: true, split: true, oldRuleId, newRuleId: newRule.id, effectiveFrom, materialized },
          { status: 500 }
        );
      }
      materialized += 1;
    }
    return NextResponse.json({ updated: true, split: true, oldRuleId, newRuleId: newRule.id, effectiveFrom, materialized });
  }

  if (dates.length) {
    const rows = dates.map((date) => ({
      household_id:      householdId,
      member_id:         newMemberId,
      category_id:       newCategoryId,
      account_id:        newAccountId,
      amount:            newAmount,
      description:       newDescription,
      date,
      type,
      source:            'manual',
      recurring_item_id: newRule.id,
    }));
    const { error: insertErr } = await supabase.from('transactions').insert(rows);
    if (insertErr) {
      console.error('Recurring PATCH (split) txn insert error:', insertErr);
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ updated: true, split: true, oldRuleId, newRuleId: newRule.id, effectiveFrom, materialized: dates.length });
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
