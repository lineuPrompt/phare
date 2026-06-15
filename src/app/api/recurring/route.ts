import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { materializeRule } from '@/lib/dateHelpers';

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
      .select('id, description, amount, type, cadence, anchor_date, second_day, active, category_id, categories(name)')
      .eq('household_id', ctx.householdId)
      .order('type', { ascending: true })
      .order('description', { ascending: true });

    return NextResponse.json({ items: items ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to load recurring items' }, { status: 500 });
  }
}

// POST: create a recurring item + materialize 12 months of transactions
export async function POST(request: Request) {
  try {
    const { description, amount, type, cadence, anchorDate, secondDay, categoryId } = await request.json();

    if (!description?.trim() || !amount || !type || !cadence || !anchorDate) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!['income', 'expense'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }
    if (!['monthly', 'biweekly', 'semimonthly'].includes(cadence)) {
      return NextResponse.json({ error: 'Invalid cadence' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await getContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!ctx.memberId) return NextResponse.json({ error: 'No member record' }, { status: 400 });

    // 1. Create the rule
    const { data: item, error: itemError } = await supabase
      .from('recurring_items')
      .insert({
        household_id: ctx.householdId,
        member_id: ctx.memberId,
        category_id: categoryId || null,
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
    const now = new Date();
    const startMonth = now.toISOString().slice(0, 7);
    const dates = materializeRule(
      { cadence, anchorDate, secondDay: secondDay ?? null },
      startMonth,
      12
    );

    // 3. Write the transaction rows, linked back to the rule
    if (dates.length) {
      const rows = dates.map((d) => ({
        household_id: ctx.householdId,
        member_id: ctx.memberId,
        category_id: categoryId || null,
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