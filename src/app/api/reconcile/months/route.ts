import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { businessMonth } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

// GET /api/reconcile/months
//
// Which months should appear as chips on the Reconcile page: only months
// that have at least one transaction (past or future), plus always the
// current month — no trail of empty past months just because they're
// within some fixed lookback window.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id as string;

    const { data: txns } = await supabase
      .from('transactions')
      .select('date')
      .eq('household_id', householdId);

    const monthsWithData = new Set<string>();
    for (const t of (txns ?? []) as { date: string }[]) {
      monthsWithData.add(t.date.slice(0, 7));
    }

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const currentMonth = businessMonth(timezone);
    monthsWithData.add(currentMonth);

    const months = Array.from(monthsWithData).sort();

    return NextResponse.json({ months });
  } catch (error) {
    console.error('Reconcile months GET error:', error);
    return NextResponse.json({ error: 'Failed to load months' }, { status: 500 });
  }
}
