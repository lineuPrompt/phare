import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
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

    const todayStr = new Date().toISOString().slice(0, 10);

    // Delete future materialized transactions for this rule (keep past as history)
    await supabase
      .from('transactions')
      .delete()
      .eq('household_id', householdId)
      .eq('recurring_item_id', id)
      .gte('date', todayStr);

    // Delete the rule itself
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