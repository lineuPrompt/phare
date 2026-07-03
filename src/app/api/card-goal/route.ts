import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

// POST: set the card goal for a specific card account and month.
// Body: { month: 'YYYY-MM', cardGoal: number, accountId: string }
// Unique constraint: (household_id, account_id, month) — each card gets its own goal.
export async function POST(request: Request) {
  try {
    const { month, cardGoal, accountId } = await request.json();

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
    }
    if (typeof cardGoal !== 'number' || cardGoal < 0) {
      return NextResponse.json({ error: 'Invalid cardGoal' }, { status: 400 });
    }
    if (!accountId || typeof accountId !== 'string') {
      return NextResponse.json({ error: 'accountId required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });

    // Guard: ensure the account belongs to this household
    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', accountId)
      .eq('household_id', userRow.household_id)
      .single();
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    const monthStart = `${month}-01`;

    const { error } = await supabase
      .from('monthly_goals')
      .upsert(
        {
          household_id: userRow.household_id,
          account_id: accountId,
          month: monthStart,
          card_goal: cardGoal,
        },
        { onConflict: 'household_id,account_id,month' }
      );

    if (error) {
      console.error('Card goal error:', error);
      return NextResponse.json({ error: 'Failed to save goal' }, { status: 500 });
    }

    return NextResponse.json({ saved: true });
  } catch {
    return NextResponse.json({ error: 'Failed to save goal' }, { status: 500 });
  }
}
