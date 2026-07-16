import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

// A manual entry (card or chequing) can be edited/deleted here. Bridge rows
// (is_bridge=true) are computed by ensureBridgesForWindow on every timeline/
// card-envelope load — they are never user-editable, since any manual change
// would just be overwritten (or resurrected) on the next ensure call.
async function loadEditableTransaction(
  supabase: Awaited<ReturnType<typeof createClient>>,
  id: string,
  householdId: string
) {
  const { data: tx } = await supabase
    .from('transactions')
    .select('id, is_bridge')
    .eq('id', id)
    .eq('household_id', householdId)
    .single();
  if (!tx) return { error: 'Not found' as const, status: 404 as const };
  if (tx.is_bridge) return { error: 'Bridge payments are computed automatically and cannot be edited directly.' as const, status: 400 as const };
  return { tx };
}

// PATCH: edit a manual entry's date/description/amount/category.
// Body: { date?, description?, amount?, categoryId? }
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

    const found = await loadEditableTransaction(supabase, id, householdId);
    if ('error' in found) return NextResponse.json({ error: found.error }, { status: found.status });

    const updates: Record<string, string | number | null> = {};
    if (body.date !== undefined) updates.date = body.date;
    if (body.description !== undefined) updates.description = body.description;
    if (body.amount !== undefined) {
      const amt = Number(body.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 });
      }
      updates.amount = amt;
    }
    if (body.categoryId !== undefined) updates.category_id = body.categoryId || null;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const { error } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', id)
      .eq('household_id', householdId);

    if (error) {
      console.error('Transaction PATCH error:', error);
      return NextResponse.json({ error: 'Failed to save entry' }, { status: 500 });
    }

    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error('Transaction PATCH threw:', error);
    return NextResponse.json({ error: 'Failed to save entry' }, { status: 500 });
  }
}

// DELETE: remove a manual entry.
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const found = await loadEditableTransaction(supabase, id, householdId);
    if ('error' in found) return NextResponse.json({ error: found.error }, { status: found.status });

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('household_id', householdId);

    if (error) {
      console.error('Transaction DELETE error:', error);
      return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Transaction DELETE threw:', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
