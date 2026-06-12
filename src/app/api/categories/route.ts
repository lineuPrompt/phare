import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

export async function POST(request: Request) {
  try {
    const { name } = await request.json();
    if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });

    const { data: cat, error } = await supabase
      .from('categories')
      .insert({ household_id: userRow.household_id, name: name.trim(), type: 'expense' })
      .select('id, name, type')
      .single();

    if (error) return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
    return NextResponse.json({ category: cat });
  } catch {
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}