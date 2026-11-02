import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { isCalendarDate, MANUAL_ENTRY_DESCRIPTION_MAX_CHARS, MANUAL_ENTRY_MAX_AMOUNT } from '@phare/core';
import { lowestGoalBalance } from '@/lib/dashboardHelpers';

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
): Promise<{ ids: string[]; type: string | null; recurringItemId: string | null; date: string | null; amount: number | null; isOpeningBalance: boolean }> {
  const [direct, reverse] = await Promise.all([
    supabase
      .from('transactions')
      .select('id, type, amount, transfer_peer_id, recurring_item_id, date, is_opening_balance')
      .eq('id', id)
      .eq('household_id', householdId)
      .maybeSingle(),

    supabase
      .from('transactions')
      .select('id, amount, recurring_item_id, date')
      .eq('transfer_peer_id', id)
      .eq('household_id', householdId),
  ]);

  // A failed read is not "no such transfer" (a 404): the caller's catch
  // answers 500 with this reason.
  if (direct.error) throw new Error(`Failed to read the transfer: ${direct.error.message}`);
  if (reverse.error) throw new Error(`Failed to read the transfer's other side: ${reverse.error.message}`);

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
  // Either side's stored amount carries the pair's sign — a draw stores both
  // sides negative, a contribution/payment stores both positive (see
  // create_transfer's sign-convention comment). Read off whichever side the
  // query found.
  const amount = target?.amount != null ? Number(target.amount) : reverse.data?.[0]?.amount != null ? Number(reverse.data[0].amount) : null;

  // An opening balance is a stated starting position, changed through the
  // account form (PATCH /api/accounts/[id]) so it stays a single upsertable
  // row. Editing it as a stray ledger line here would sidestep that and, on
  // delete, tombstone a date that never had an occurrence.
  const isOpeningBalance = target?.is_opening_balance === true;

  return { ids: [...ids], type, recurringItemId, date, amount, isOpeningBalance };
}

/** Shared refusal so PATCH and DELETE cannot drift on the wording or the rule. */
const OPENING_BALANCE_LOCKED = {
  error: "This is the account's opening balance, not a contribution. Change it in the goal's settings — editing it here would turn a stated starting position into a movement.",
} as const;

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
  // NOT best-effort (docs/tickets/expenses-patch-route-gaps.md): a lost
  // tombstone let a later rule edit bring the occurrence back. Written before
  // the edit or delete, so a failure refuses with nothing changed. One that
  // already exists (unique on rule + date, e.g. a retry) is success.
  const { error } = await supabase
    .from('recurring_skipped_dates')
    .insert({ household_id: householdId, recurring_item_id: recurringItemId, date });
  if (error && error.code !== '23505') {
    console.error('tombstoneOccurrence insert error:', error);
    return error.message as string;
  }
  return null;
}

function tombstoneFailed(reason: string) {
  return NextResponse.json(
    { error: `This transfer repeats; it could not be detached from its rule, so nothing was changed: ${reason}`, code: 'DETACH_FAILED' },
    { status: 500 }
  );
}

// ---------------------------------------------------------------------------
// THE SAVINGS FLOOR ON EDIT AND DELETE (2026-11-02).
//
// POST refuses a withdrawal above the balance on its date. Editing or deleting
// could still go around it: a withdrawal edited larger, a contribution edited
// smaller or later, or a contribution deleted from under a later withdrawal.
// So after the change, a savings-type account (savings, TFSA, RRSP, the
// Reserve Fund) must never reach a balance below zero — or below the lowest it
// already reaches, so an account that already dips (a Reserve paying a bill
// before it is funded) is not locked against every change. A debt account has
// no floor: borrowing is what makes it negative. Same balance rule as the
// Goals page (computeGoalBalance), at every date of the account's rows.
// ---------------------------------------------------------------------------

const SAVINGS_TYPES = new Set(['savings', 'tfsa', 'rrsp']);

async function savingsFloorRefusal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  householdId: string,
  ids: string[],
  change: { kind: 'delete' } | { kind: 'patch'; signedAmount: number; date: string | null }
): Promise<NextResponse | null> {
  const lookupFailed = (what: string, message: string) =>
    NextResponse.json({ error: `Could not check the account balance (${what}): ${message}`, code: 'LOOKUP_FAILED' }, { status: 500 });

  const { data: pairRows, error: pairErr } = await supabase
    .from('transactions')
    .select('id, account_id')
    .in('id', ids)
    .eq('household_id', householdId);
  if (pairErr) return lookupFailed('pair', pairErr.message);

  const accountIds = [...new Set((pairRows ?? []).map((r) => r.account_id as string | null).filter((a): a is string => !!a))];
  if (accountIds.length === 0) return null;
  const { data: accounts, error: acctErr } = await supabase
    .from('accounts')
    .select('id, name, type')
    .in('id', accountIds)
    .eq('household_id', householdId);
  if (acctErr) return lookupFailed('accounts', acctErr.message);

  const goal = (accounts ?? []).find((a) => SAVINGS_TYPES.has(a.type as string));
  if (!goal) return null;
  const goalRowId = (pairRows ?? []).find((r) => r.account_id === goal.id)?.id as string | undefined;
  if (!goalRowId) return null;

  const { data: rows, error: rowsErr } = await supabase
    .from('transactions')
    .select('id, amount, type, account_id, date')
    .eq('household_id', householdId)
    .eq('account_id', goal.id);
  if (rowsErr) return lookupFailed('rows', rowsErr.message);

  const current = (rows ?? []) as { id: string; amount: number | string; type: string; account_id: string; date: string }[];
  const after = change.kind === 'delete'
    ? current.filter((r) => r.id !== goalRowId)
    : current.map((r) => (r.id === goalRowId ? { ...r, amount: change.signedAmount, date: change.date ?? r.date } : r));

  const before = lowestGoalBalance(current, goal.id as string);
  const low = lowestGoalBalance(after, goal.id as string);
  if (low && low.balance < 0 && low.balance < (before?.balance ?? 0) - 0.005) {
    return NextResponse.json(
      {
        error: `This would take ${goal.name} to ${low.balance.toFixed(2)} on ${low.date}; a savings account cannot go below zero.`,
        code: 'BALANCE_WOULD_GO_NEGATIVE',
        account: goal.name,
        date: low.date,
        balance: low.balance,
      },
      { status: 400 }
    );
  }
  return null;
}

// PATCH: update a transfer's amount, date, and/or description on BOTH sides of the pair.
// Works correctly when given either the chequing-side or goal-side id,
// and recovers from a broken peer link on either side.
// Body: { amount, date?, description? } — amount is always a positive
// MAGNITUDE (same as the create form). A draw's pair is stored negative on
// both sides (see create_transfer's sign-convention comment); the sign is
// re-derived from the pair's EXISTING stored amount here, never trusted from
// the client, so editing a draw can't silently reclassify it as a
// contribution (or vice versa) by flipping its sign.
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

    // The create limits (docs/tickets/expenses-patch-route-gaps.md): a
    // positive amount no larger than the manual-entry ceiling, a real
    // calendar date, a description of at most 200 characters (null clears it).
    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    }
    if (Number(amount) > MANUAL_ENTRY_MAX_AMOUNT) {
      return NextResponse.json({ error: `Amount must be at most ${MANUAL_ENTRY_MAX_AMOUNT}`, code: 'INVALID_AMOUNT' }, { status: 400 });
    }
    if (date !== undefined && date !== null && date !== '' && !isCalendarDate(date)) {
      return NextResponse.json({ error: 'date must be a real calendar date written as YYYY-MM-DD.', code: 'INVALID_DATE' }, { status: 400 });
    }
    if (typeof description === 'string' && description.trim().length > MANUAL_ENTRY_DESCRIPTION_MAX_CHARS) {
      return NextResponse.json(
        { error: `description is ${description.trim().length} characters; the limit is ${MANUAL_ENTRY_DESCRIPTION_MAX_CHARS}.`, code: 'DESCRIPTION_TOO_LONG' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { ids, type, recurringItemId, date: originalDate, amount: existingAmount, isOpeningBalance } = await resolvePair(supabase, id, householdId);

    if (ids.length === 0 || type !== 'transfer') {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }
    if (isOpeningBalance) {
      return NextResponse.json(OPENING_BALANCE_LOCKED, { status: 400 });
    }

    const sign = (existingAmount ?? 0) < 0 ? -1 : 1;
    const patch: Record<string, unknown> = { amount: sign * Number(amount) };
    if (date) patch.date = date;
    if (description !== undefined) patch.description = description?.trim() ?? null;

    // Before anything is written, tombstone included.
    const floor = await savingsFloorRefusal(supabase, householdId, ids, {
      kind: 'patch', signedAmount: sign * Number(amount), date: date || null,
    });
    if (floor) return floor;

    // Detach-on-edit (Part A3, transfer flavor): editing a single
    // materialized recurring contribution/debt-payment occurrence tombstones
    // its original date so a later rule edit can't regenerate it, then
    // clears recurring_item_id on BOTH pair rows in the same update.
    if (recurringItemId && originalDate) {
      const tombstoneErr = await tombstoneOccurrence(supabase, householdId, recurringItemId, originalDate);
      if (tombstoneErr) return tombstoneFailed(tombstoneErr);
      patch.recurring_item_id = null;
    }

    // .select() reports what the update actually touched: a pair deleted
    // between resolvePair and here is not `updated: true`.
    const { data: updatedRows, error } = await supabase
      .from('transactions')
      .update(patch)
      .in('id', ids)
      .eq('household_id', householdId)
      .select('id');

    if (error) {
      console.error('Transfer PATCH error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json({ error: 'Transfer no longer exists' }, { status: 409 });
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

    const { ids, type, recurringItemId, date: originalDate, isOpeningBalance } = await resolvePair(supabase, id, householdId);

    if (ids.length === 0 || type !== 'transfer') {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }
    if (isOpeningBalance) {
      return NextResponse.json(OPENING_BALANCE_LOCKED, { status: 400 });
    }

    // Before anything is written, tombstone included.
    const floor = await savingsFloorRefusal(supabase, householdId, ids, { kind: 'delete' });
    if (floor) return floor;

    // Detach-on-delete (Part A3, transfer flavor): tombstone before the pair
    // disappears, same rationale as the PATCH branch above.
    if (recurringItemId && originalDate) {
      const tombstoneErr = await tombstoneOccurrence(supabase, householdId, recurringItemId, originalDate);
      if (tombstoneErr) return tombstoneFailed(tombstoneErr);
    }

    const { data: deletedRows, error } = await supabase
      .from('transactions')
      .delete()
      .in('id', ids)
      .eq('household_id', householdId)
      .select('id');

    if (error) {
      console.error('Transfer DELETE error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: 'Transfer no longer exists' }, { status: 409 });
    }

    return NextResponse.json({ deleted: true, ids });
  } catch (error) {
    console.error('Transfer DELETE threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
