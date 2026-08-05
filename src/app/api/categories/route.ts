import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { requirePro } from '@/lib/proGate';

// GET: household's expense categories (id, name) — the shared read path for
// any form that needs a category selector (Timeline's chequing entry form,
// Cards' add-expense form, Recurring).
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });

    const { data: categories } = await supabase
      .from('categories')
      .select('id, name')
      .eq('household_id', userRow.household_id)
      .eq('type', 'expense')
      .order('name');

    return NextResponse.json({ categories: categories ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to load categories' }, { status: 500 });
  }
}

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

    // CREATING a category is Pro. READING and USING existing ones is not, and
    // this route's GET is deliberately ungated.
    //
    // A household that was Pro and drops to free keeps every custom category
    // it made: still listed, still selectable, still attached to every past
    // transaction. Nothing is deleted, hidden, or migrated. A paywall changes
    // what someone can do NEXT — it must never reach backwards into data they
    // already own, which would be taking something away rather than declining
    // to sell more of it.
    //
    // There is no is_system column to lean on: the seeded ten come from the
    // signup trigger and are otherwise ordinary rows. "Free uses system
    // categories only" is therefore enforced as "free adds none", which is
    // the same rule for anyone starting free and strictly kinder to anyone
    // who lapses.
    const gate = await requirePro(supabase, userRow.household_id, 'custom_categories');
    if (!gate.allowed) return gate.response;

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