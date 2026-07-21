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
): Promise<{ ids: string[]; type: string | null; recurringItemId: string | null; date: string | null }> {
  const [direct, reverse] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, type, transfer_peer_id, recurring_item_id, date')
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle(),

    supabase
      .from('transactions')
      .select('id, recurring_item_id, date')
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

  // create_transfer tags recurring_item_id on both sides of a materialized
  // pair — read it off whichever side the query found it on.
  const recurringItemId = target?.recurring_item_id ?? reverse.data?.[0]?.recurring_item_id ?? null;
  const date = target?.date ?? reverse.data?.[0]?.date ?? null;

  return { ids: [...ids], type, recurringItemId, date };
}

// See src/app/api/expenses/[id]/route.ts's identical helper for the full
// rationale — same detach-on-edit/delete tombstone mechanism, applied here
// to a recurring TRANSFER occurrence's paired rows instead of a single
// income/expense row.
async function tombstoneOccurrence(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  recurringItemId: string,
  date: string
) {
  const { error } = await supabase
    .from('recurring_skipped_dates')
    .insert({ household_id: householdId, recurring_item_id: recurringItemId, date });
  if (error) {
    console.error('tombstoneOccurrence insert error (non-fatal):', error);
  }
}

// PATCH: update a transfer's amount, date, and/or description on BOTH sides of the pair.
// Works correctly when given either the chequing-side or goal-side id,
// and recovers from a broken peer link on either side.
// Body: { amount, date?, description? }
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { amount, date, description } = body as {
      amount: number;
      date?: string;
      description?: string | null;
    };

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    }

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { ids, type, recurringItemId, date: originalDate } = await resolvePair(supabase, id, householdId);

    if (ids.length === 0 || type !== 'transfer') {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    const patch: Record<string, unknown> = { amount: Number(amount) };
    if (date) patch.date = date;
    if (description !== undefined) patch.description = description?.trim() ?? null;

    // Detach-on-edit (Part A3, transfer flavor): editing a single
    // materialized recurring contribution/debt-payment occurrence tombstones
    // its original date so a later rule edit can't regenerate it, then
    // clears recurring_item_id on BOTH pair rows in the same update.
    if (recurringItemId && originalDate) {
      await tombstoneOccurrence(supabase, householdId, recurringItemId, originalDate);
      patch.recurring_item_id = null;
    }

    const { error } = await supabase
      .from('transactions')
      .update(patch)
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

    const { ids, type, recurringItemId, date: originalDate } = await resolvePair(supabase, id, householdId);

    if (ids.length === 0 || type !== 'transfer') {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    // Detach-on-delete (Part A3, transfer flavor): tombstone before the pair
    // disappears, same rationale as the PATCH branch above.
    if (recurringItemId && originalDate) {
      await tombstoneOccurrence(supabase, householdId, recurringItemId, originalDate);
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
