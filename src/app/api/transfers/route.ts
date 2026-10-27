import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { GOAL_ACCOUNT_TYPES, computeGoalBalance } from '@/lib/dashboardHelpers';

const GOAL_TYPE_SET = new Set<string>(GOAL_ACCOUNT_TYPES);

async function getContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  if (!userRow?.household_id) return null;
  const { data: member } = await supabase
    .from('household_members').select('id')
    .eq('household_id', userRow.household_id).eq('user_id', user.id).single();
  return { householdId: userRow.household_id, memberId: member?.id ?? null };
}

// POST: create a chequing ↔ goal transfer (atomic via RPC).
// Both rows and both transfer_peer_id links are written inside a single Postgres
// transaction. Any failure rolls back completely — no partial pair can persist.
// Body: { date, amount, description?, goalAccountId, kind? }
// kind: 'contribution' (default) — chequing → goal, the existing behaviour.
//       'draw' — goal → chequing, from any goal account (2026-10-27): borrowing
//       against a debt account, or withdrawing from a savings-type one (the
//       Reserve Fund included) — the same mechanism for both, as Lineu asked.
//       See create_transfer's sign-convention comment (20260801000000
//       migration) for why this needs no separate balance/reconciliation
//       "kind" field — the stored amount's sign alone carries the direction,
//       and the goal account's type says borrowed or withdrawn.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { date, amount, goalAccountId } = body;
    const description: string | undefined = body.description;
    const kind: 'contribution' | 'draw' = body.kind === 'draw' ? 'draw' : 'contribution';

    // --- Input validation (400, before any DB call) ---
    if (!date || !amount || !goalAccountId) {
      return NextResponse.json({ error: 'Missing required fields: date, amount, goalAccountId' }, { status: 400 });
    }
    if (Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await getContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!ctx.memberId) return NextResponse.json({ error: 'No member record' }, { status: 400 });

    const { householdId, memberId } = ctx;

    // Verify goal account belongs to this household and is a goal type (400 — user error)
    const { data: goalAccount } = await supabase
      .from('accounts')
      .select('id, name, type')
      .eq('id', goalAccountId)
      .eq('household_id', householdId)
      .single();

    if (!goalAccount || !GOAL_TYPE_SET.has(goalAccount.type)) {
      return NextResponse.json({ error: 'Invalid goal account' }, { status: 400 });
    }
    // A draw from a savings-type account is a withdrawal: it cannot take out
    // more than the account holds on that date. The balance is the same
    // ledger sum the Goals and Reserve pages show (computeGoalBalance), as of
    // the withdrawal's own date — rows dated after it do not count. A debt
    // draw has no such floor: borrowing is what makes its balance negative.
    if (kind === 'draw' && goalAccount.type !== 'debt') {
      const { data: goalRows, error: goalRowsErr } = await supabase
        .from('transactions')
        .select('amount, type, account_id, date')
        .eq('household_id', householdId)
        .eq('account_id', goalAccountId);
      if (goalRowsErr) {
        console.error('Transfer POST balance read error:', goalRowsErr);
        return NextResponse.json({ error: `Could not read the account balance: ${goalRowsErr.message}`, code: 'LOOKUP_FAILED' }, { status: 500 });
      }
      const available = computeGoalBalance(goalRows ?? [], goalAccountId, date);
      if (Number(amount) > available) {
        return NextResponse.json(
          {
            error: `This account holds ${available.toFixed(2)} on ${date}; a withdrawal cannot be larger.`,
            code: 'INSUFFICIENT_BALANCE',
            available,
          },
          { status: 400 }
        );
      }
    }

    // A blank description used to leave both peer rows unlabeled (the
    // Timeline showed a bare "🪙 Entry", Goals' Upcoming showed "—") — default
    // to the destination's own name so a transfer is never nameless.
    // "(payment)" for a contribution to a debt destination, "(draw)" for a
    // debt draw, "(withdrawal)" for a draw from a savings-type account,
    // matching the labels the Timeline/Goals UI expects.
    const resolvedDescription =
      description?.trim() ||
      (kind === 'draw'
        ? goalAccount.type === 'debt'
          ? `${goalAccount.name} (draw)`
          : `${goalAccount.name} (withdrawal)`
        : goalAccount.type === 'debt'
          ? `${goalAccount.name} (payment)`
          : goalAccount.name);

    // Resolve chequing account (400 — configuration error, fixable by user)
    const { data: chequing } = await supabase
      .from('accounts')
      .select('id')
      .eq('household_id', householdId)
      .eq('type', 'chequing')
      .single();

    if (!chequing) {
      return NextResponse.json({ error: 'No chequing account found' }, { status: 400 });
    }

    // --- Atomic RPC (500 if it throws — not a user error) ---
    const { data: result, error: rpcErr } = await supabase.rpc('create_transfer', {
      p_household_id: householdId,
      p_member_id:    memberId,
      p_chequing_id:  chequing.id,
      p_goal_id:      goalAccountId,
      p_amount:       Number(amount),
      p_date:         date,
      p_description:  resolvedDescription,
      p_kind:         kind,
    });

    if (rpcErr) {
      console.error('create_transfer RPC error:', rpcErr);
      // Honest-error contract: surface the real server reason, not a
      // generic message that would have hidden the create_transfer
      // overload-ambiguity bug (fixed in 20260719000000) from ever being
      // diagnosed from the client side.
      return NextResponse.json({ error: rpcErr.message || 'Failed to create transfer' }, { status: 500 });
    }

    return NextResponse.json({
      created:       true,
      chequingRowId: result.chequing_row_id,
      goalRowId:     result.goal_row_id,
    });
  } catch (error) {
    console.error('Transfer POST threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
