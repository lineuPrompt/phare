import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { formatLocalDate, materializeFutureRule } from '@/lib/dateHelpers';
import { GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';

async function getContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  if (!userRow?.household_id) return null;
  const { data: member } = await supabase
    .from('household_members').select('id')
    .eq('household_id', userRow.household_id).eq('user_id', user.id).single();
  return { userId: user.id, householdId: userRow.household_id, memberId: member?.id ?? null };
}

// GET: list recurring items for the household
export async function GET() {
  try {
    const supabase = await createClient();
    const ctx = await getContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: items } = await supabase
      .from('recurring_items')
      .select('id, description, amount, type, cadence, anchor_date, second_day, active, category_id, account_id, member_id, categories(name), accounts(name, type), household_members(name)')
      .eq('household_id', ctx.householdId)
      .order('type', { ascending: true })
      .order('description', { ascending: true });

    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name, type')
      .eq('household_id', ctx.householdId)
      .order('type', { ascending: true });

    // Goal accounts (savings/tfsa/rrsp) cannot be the target of a recurring
    // expense or income — they only receive money via transfers.
    const spendingAccounts = (accounts ?? []).filter(
      (a) => !(GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type)
    );

    const { data: categories } = await supabase
      .from('categories')
      .select('id, name')
      .eq('household_id', ctx.householdId)
      .eq('type', 'expense')
      .order('name');

    return NextResponse.json({ items: items ?? [], accounts: spendingAccounts, categories: categories ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to load recurring items' }, { status: 500 });
  }
}

// POST: create a recurring item + materialize 12 months of transactions
export async function POST(request: Request) {
  try {
    const { description, amount, type, cadence, anchorDate, secondDay, categoryId, accountId } = await request.json();

    if (!description?.trim() || !amount || !type || !cadence || !anchorDate || !accountId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!['income', 'expense'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }
    if (!['monthly', 'biweekly', 'semimonthly'].includes(cadence)) {
      return NextResponse.json({ error: 'Invalid cadence' }, { status: 400 });
    }
    if (type === 'expense' && !categoryId) {
      return NextResponse.json({ error: 'Category required for expense recurring items' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await getContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!ctx.memberId) return NextResponse.json({ error: 'No member record' }, { status: 400 });

    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .eq('household_id', ctx.householdId)
      .single();
    if (!account) {
      return NextResponse.json({ error: 'Invalid account' }, { status: 400 });
    }

    // 1. Create the rule
    const { data: item, error: itemError } = await supabase
      .from('recurring_items')
      .insert({
        household_id: ctx.householdId,
        member_id: ctx.memberId,
        category_id: categoryId || null,
        account_id: accountId,
        description: description.trim(),
        amount,
        type,
        cadence,
        anchor_date: anchorDate,
        second_day: secondDay ?? null,
      })
      .select('id')
      .single();

    if (itemError || !item) {
      console.error('Recurring insert error:', itemError);
      return NextResponse.json({ error: 'Failed to create recurring item' }, { status: 500 });
    }

    // 2. Materialize 12 months forward from current month
    const today = formatLocalDate(new Date());
    const dates = materializeFutureRule(
      { cadence, anchorDate, secondDay: secondDay ?? null },
      today,
      12
    );

    // 3. Idempotently write future transaction rows, linked back to the rule
    const { error: deleteError } = await supabase
      .from('transactions')
      .delete()
      .eq('household_id', ctx.householdId)
      .eq('recurring_item_id', item.id)
      .gte('date', today);

    if (deleteError) {
      console.error('Materialize cleanup error:', deleteError);
      return NextResponse.json({ error: 'Item created but materialization cleanup failed' }, { status: 500 });
    }

    if (dates.length) {
      const rows = dates.map((d) => ({
        household_id: ctx.householdId,
        member_id: ctx.memberId,
        category_id: categoryId || null,
        account_id: accountId,
        amount,
        description: description.trim(),
        date: d,
        type,
        source: 'manual',
        recurring_item_id: item.id,
      }));
      const { error: txError } = await supabase.from('transactions').insert(rows);
      if (txError) {
        console.error('Materialize insert error:', txError);
        return NextResponse.json({ error: 'Item created but materialization failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ created: true, id: item.id, materialized: dates.length });
  } catch (error) {
    console.error('Recurring POST error:', error);
    return NextResponse.json({ error: 'Failed to create recurring item' }, { status: 500 });
  }
}
