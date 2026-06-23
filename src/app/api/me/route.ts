import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id, role, full_name')
      .eq('id', user.id)
      .single();

    if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    return NextResponse.json({
      id: user.id,
      email: user.email,
      role: userRow.role,
      household_id: userRow.household_id,
      full_name: userRow.full_name,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load user' }, { status: 500 });
  }
}
