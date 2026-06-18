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

// PATCH: change a recurring rule's account, re-pointing FUTURE materialized rows
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { accountId } = await request.json();

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!accountId) return NextResponse.json({ error: 'Missing account' }, { status: 400 });

    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .eq('household_id', householdId)
      .single();
    if (!account) {
      return NextResponse.json({ error: 'Invalid account' }, { status: 400 });
    }

    // Update the rule's account
    const { data: item, error: ruleErr } = await supabase
      .from('recurring_items')
      .update({ account_id: accountId })
      .eq('id', id)
      .eq('household_id', householdId)
      .select('id, household_id, member_id, category_id, account_id, description, amount, type, cadence, anchor_date, second_day')
      .single();

    if (ruleErr || !item) {
      console.error('Recurring PATCH rule error:', ruleErr);
      return NextResponse.json({ error: ruleErr?.message ?? 'Recurring item not found' }, { status: 500 });
    }

    // Re-point this rule's FUTURE transactions by rebuilding the linked series (past = history)
    const todayStr = formatLocalDate(new Date());
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

    const dates = materializeFutureRule(
      {
        cadence: item.cadence as 'monthly' | 'biweekly' | 'semimonthly',
        anchorDate: item.anchor_date,
        secondDay: item.second_day,
      },
      todayStr,
      12
    );

    if (dates.length) {
      let orphanQuery = supabase
        .from('transactions')
        .delete()
        .eq('household_id', householdId)
        .is('recurring_item_id', null)
        .eq('description', item.description)
        .eq('amount', item.amount)
        .eq('type', item.type)
        .gte('date', todayStr)
        .in('date', dates);

      orphanQuery = item.category_id
        ? orphanQuery.eq('category_id', item.category_id)
        : orphanQuery.is('category_id', null);

      const { error: orphanErr } = await orphanQuery;
      if (orphanErr) {
        console.error('Recurring PATCH orphan cleanup error:', orphanErr);
        return NextResponse.json({ error: orphanErr.message }, { status: 500 });
      }
    }

    if (dates.length) {
      const rows = dates.map((date) => ({
        household_id: householdId,
        member_id: item.member_id,
        category_id: item.category_id,
        account_id: accountId,
        amount: item.amount,
        description: item.description,
        date,
        type: item.type,
        source: 'manual',
        recurring_item_id: item.id,
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
