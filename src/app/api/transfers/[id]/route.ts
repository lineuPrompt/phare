import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

// PATCH: update a transfer's amount (both sides of the pair)
// Body: { amount }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { amount } = await request.json();

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    }

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // Fetch this row and its peer id
    const { data: tx } = await supabase
      .from('transactions')
      .select('id, transfer_peer_id, type')
      .eq('id', id)
      .eq('household_id', householdId)
      .single();

    if (!tx || tx.type !== 'transfer') {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    const numAmount = Number(amount);
    const ids = [id, tx.transfer_peer_id].filter((x): x is string => x !== null);

    const { error } = await supabase
      .from('transactions')
      .update({ amount: numAmount })
      .in('id', ids)
      .eq('household_id', householdId);

    if (error) {
      console.error('Transfer PATCH error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ updated: true, ids });
  } catch (error) {
    console.error('Transfer PATCH threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// DELETE: remove both sides of a transfer pair
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // Fetch peer id before deleting (ON DELETE SET NULL would clear it after)
    const { data: tx } = await supabase
      .from('transactions')
      .select('id, transfer_peer_id, type')
      .eq('id', id)
      .eq('household_id', householdId)
      .single();

    if (!tx || tx.type !== 'transfer') {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    const ids = [id, tx.transfer_peer_id].filter((x): x is string => x !== null);

    const { error } = await supabase
      .from('transactions')
      .delete()
      .in('id', ids)
      .eq('household_id', householdId);

    if (error) {
      console.error('Transfer DELETE error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deleted: true, ids });
  } catch (error) {
    console.error('Transfer DELETE threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
