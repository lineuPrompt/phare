import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

/**
 * Resolve all rows that belong to a transfer pair, given either side's id.
 *
 * Two queries run in parallel:
 *   Q1  WHERE id = $id                  — the row the caller named
 *   Q2  WHERE transfer_peer_id = $id    — any row that points TO the caller's row
 *
 * Together they find the complete pair even when one direction of the peer link
 * is null (e.g. a pre-RPC transfer where the goal row's transfer_peer_id was
 * never written). As long as at least one link in the pair is intact, both
 * rows are found and operated on.
 */
async function resolvePair(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  householdId: string
): Promise<{ ids: string[]; type: string | null }> {
  const [direct, reverse] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, type, transfer_peer_id')
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle(),

    supabase
      .from('transactions')
      .select('id')
      .eq('transfer_peer_id', id)
      .eq('household_id', householdId),
  ]);

  const target = direct.data;
  const type = target?.type ?? null;

  const ids = new Set<string>();
  if (target) {
    ids.add(target.id);
    if (target.transfer_peer_id) ids.add(target.transfer_peer_id);
  }
  for (const row of reverse.data ?? []) {
    ids.add(row.id);
  }

  return { ids: [...ids], type };
}

// PATCH: update a transfer's amount on BOTH sides of the pair.
// Works correctly when given either the chequing-side or goal-side id,
// and recovers from a broken peer link on either side.
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

    const { ids, type } = await resolvePair(supabase, id, householdId);

    if (ids.length === 0 || type !== 'transfer') {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    const { error } = await supabase
      .from('transactions')
      .update({ amount: Number(amount) })
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

// DELETE: remove BOTH sides of a transfer pair.
// Works correctly when given either the chequing-side or goal-side id,
// and recovers from a broken peer link on either side.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { ids, type } = await resolvePair(supabase, id, householdId);

    if (ids.length === 0 || type !== 'transfer') {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

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
