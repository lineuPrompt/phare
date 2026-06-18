import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

// DELETE: remove an account. Chequing cannot be deleted (it's the base account).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // Guard: don't allow deleting the chequing account
    const { data: account } = await supabase
      .from('accounts')
      .select('type')
      .eq('id', id)
      .eq('household_id', householdId)
      .single();

    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (account.type === 'chequing') {
      return NextResponse.json({ error: 'Cannot delete the chequing account' }, { status: 400 });
    }

    // Block deletion when transactions exist — account_id is NOT NULL in the DB
    const { count } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', id);
    if (count && count > 0) {
      return NextResponse.json(
        { error: 'Cannot delete an account that has transactions. Remove all transactions first.' },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('id', id)
      .eq('household_id', householdId);

    if (error) {
      console.error('Account delete error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Account DELETE threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}