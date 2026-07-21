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
    .select('id, is_bridge, recurring_item_id, date')
    .eq('id', id)
    .eq('household_id', householdId)
    .single();
  if (!tx) return { error: 'Not found' as const, status: 404 as const };
  if (tx.is_bridge) return { error: 'Bridge payments are computed automatically and cannot be edited directly.' as const, status: 400 as const };
  return { tx: tx as { id: string; is_bridge: boolean; recurring_item_id: string | null; date: string } };
}

// Editing or deleting a single materialized recurring occurrence detaches it
// from its rule: a tombstone records "rule X must never regenerate an
// occurrence dated Y again" (recurring_skipped_dates), keyed to the
// occurrence's ORIGINAL date — even if the edit itself also moves the date —
// since that original date is the slot the rule's own cadence would still
// try to fill on a future rule edit. The row's recurring_item_id is cleared
// by the caller as part of the same update; for a delete there's no row left
// afterward, so the tombstone is the only trace that date was ever handled.
// Best-effort: a failed tombstone write must not block the user's edit/delete
// from succeeding — the visible cost of a lost tombstone is a possible future
// re-materialization collision, not data loss right now.
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
    // Money in/out toggle. Categories in this app are expense-only, so
    // flipping to income clears any category unless the caller sent one
    // explicitly in the same request.
    if (body.type !== undefined) {
      if (!['income', 'expense'].includes(body.type)) {
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
      }
      updates.type = body.type;
      if (body.type === 'income' && body.categoryId === undefined) {
        updates.category_id = null;
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    // Detach-on-edit (Part A3): this row is a live materialized recurring
    // occurrence. Tombstone its original date so a later edit to the RULE
    // never regenerates it, then clear recurring_item_id in the same update
    // — it becomes a standalone one-off from here on, exactly like A1.
    if (found.tx.recurring_item_id) {
      await tombstoneOccurrence(supabase, householdId, found.tx.recurring_item_id, found.tx.date);
      updates.recurring_item_id = null;
    }

    // .select() makes the update conditional and reports what it actually
    // touched — loadEditableTransaction's earlier read only proves the row
    // existed AT THAT MOMENT; a concurrent delete (another tab, or the same
    // entry's own bridge-recompute path) between that read and this write
    // would otherwise still return {saved: true} for a write that touched
    // nothing (transactions.update with no matching row is not a Postgres
    // error — it's an empty, silently "successful" no-op).
    const { data: updatedRows, error } = await supabase
      .from('transactions')
      .update(updates)
      .eq('id', id)
      .eq('household_id', householdId)
      .select('id');

    if (error) {
      console.error('Transaction PATCH error:', error);
      return NextResponse.json({ error: 'Failed to save entry' }, { status: 500 });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: 'Entry no longer exists' }, { status: 409 });
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

    // Detach-on-delete (Part A3): deleting a materialized recurring
    // occurrence must not let a later rule edit resurrect it. Tombstone
    // BEFORE the row disappears — it's the only trace this date was ever
    // handled once the row itself is gone.
    if (found.tx.recurring_item_id) {
      await tombstoneOccurrence(supabase, householdId, found.tx.recurring_item_id, found.tx.date);
    }

    // See PATCH above: .select() makes this conditional so a lost race
    // (already deleted between loadEditableTransaction's read and here)
    // reports honestly instead of a bare, indistinguishable {deleted: true}.
    const { data: deletedRows, error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('household_id', householdId)
      .select('id');

    if (error) {
      console.error('Transaction DELETE error:', error);
      return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
    }
    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: 'Entry no longer exists' }, { status: 409 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Transaction DELETE threw:', error);
    return NextResponse.json({ error: 'Failed to delete entry' }, { status: 500 });
  }
}
