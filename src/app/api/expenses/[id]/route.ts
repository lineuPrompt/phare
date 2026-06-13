import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

// PATCH: edit one expense
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { date, description, categoryId, amount } = await request.json();

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { error } = await supabase
      .from('transactions')
      .update({
        date,
        description: description?.trim(),
        category_id: categoryId || null,
        amount,
      })
      .eq('id', id)
      .eq('household_id', householdId);

    if (error) {
      console.error('PATCH update error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ updated: true });
  } catch (err) {
    console.error('PATCH threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

// DELETE: remove one expense, or the whole future series (?series=true)
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const series = url.searchParams.get('series') === 'true';

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    if (series) {
      const { data: row } = await supabase
        .from('transactions')
        .select('recurrence_id, date')
        .eq('id', id)
        .eq('household_id', householdId)
        .single();

      if (row?.recurrence_id) {
        await supabase
          .from('transactions')
          .delete()
          .eq('household_id', householdId)
          .eq('recurrence_id', row.recurrence_id)
          .gte('date', row.date);
        return NextResponse.json({ deleted: true, series: true });
      }
    }

    const { error } = await supabase
      .from('transactions')
      .delete()
      .eq('id', id)
      .eq('household_id', householdId);

    if (error) {
      console.error('DELETE error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error('DELETE threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}