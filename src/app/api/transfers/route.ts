import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';

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

// POST: create a chequing → goal transfer
// Creates two linked transaction rows (transfer_peer_id).
// Body: { date, amount, description?, goalAccountId }
export async function POST(request: Request) {
  try {
    const { date, amount, description, goalAccountId } = await request.json();

    if (!date || !amount || !goalAccountId) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await getContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!ctx.memberId) return NextResponse.json({ error: 'No member record' }, { status: 400 });

    const { householdId, memberId } = ctx;

    // Verify goal account belongs to household and is a goal type
    const { data: goalAccount } = await supabase
      .from('accounts')
      .select('id, type')
      .eq('id', goalAccountId)
      .eq('household_id', householdId)
      .single();

    if (!goalAccount || !GOAL_TYPE_SET.has(goalAccount.type)) {
      return NextResponse.json({ error: 'Invalid goal account' }, { status: 400 });
    }

    // Find chequing account
    const { data: chequing } = await supabase
      .from('accounts')
      .select('id')
      .eq('household_id', householdId)
      .eq('type', 'chequing')
      .single();

    if (!chequing) {
      return NextResponse.json({ error: 'No chequing account found' }, { status: 400 });
    }

    const desc = description?.trim() || null;
    const numAmount = Number(amount);

    // Step 1: insert goal-side row (no peer yet)
    const { data: goalRow, error: goalErr } = await supabase
      .from('transactions')
      .insert({
        household_id: householdId,
        member_id: memberId,
        account_id: goalAccountId,
        amount: numAmount,
        description: desc,
        date,
        type: 'transfer',
        source: 'manual',
      })
      .select('id')
      .single();

    if (goalErr || !goalRow) {
      console.error('Transfer goal-side insert error:', goalErr);
      return NextResponse.json({ error: 'Failed to create transfer' }, { status: 500 });
    }

    // Step 2: insert chequing-side row pointing to goal
    const { data: chqRow, error: chqErr } = await supabase
      .from('transactions')
      .insert({
        household_id: householdId,
        member_id: memberId,
        account_id: chequing.id,
        amount: numAmount,
        description: desc,
        date,
        type: 'transfer',
        source: 'manual',
        transfer_peer_id: goalRow.id,
      })
      .select('id')
      .single();

    if (chqErr || !chqRow) {
      // Clean up orphan goal row
      await supabase.from('transactions').delete().eq('id', goalRow.id);
      console.error('Transfer chequing-side insert error:', chqErr);
      return NextResponse.json({ error: 'Failed to create transfer' }, { status: 500 });
    }

    // Step 3: link goal-side back to chequing-side
    const { error: linkErr } = await supabase
      .from('transactions')
      .update({ transfer_peer_id: chqRow.id })
      .eq('id', goalRow.id);

    if (linkErr) {
      // Transfer exists but peer link is one-sided; log for monitoring
      console.error('Transfer peer link error:', linkErr);
    }

    return NextResponse.json({
      created: true,
      chequingRowId: chqRow.id,
      goalRowId: goalRow.id,
    });
  } catch (error) {
    console.error('Transfer POST threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
