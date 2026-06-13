import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

// POST: set the card goal for a given month (carries forward until changed)
export async function POST(request: Request) {
  try {
    const { month, cardGoal } = await request.json();
    if (!month || !/^\d{4}-\d{2}$/.test(month) || typeof cardGoal !== 'number' || cardGoal < 0) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });

    const monthStart = `${month}-01`;

    // Upsert: one goal per household per month
    const { error } = await supabase
      .from('monthly_goals')
      .upsert(
        { household_id: userRow.household_id, month: monthStart, card_goal: cardGoal },
        { onConflict: 'household_id,month' }
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