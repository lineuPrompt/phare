import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';

async function getHousehold(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  return userRow?.household_id ?? null;
}

// GET: list household accounts (chequing first, then cards)
export async function GET() {
  try {
    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name, type, statement_close_day, payment_day')
      .eq('household_id', householdId)
      .order('type', { ascending: true })
      .order('name', { ascending: true });

    return NextResponse.json({ accounts: accounts ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 });
  }
}

// POST: create an account (a credit card or line of credit)
export async function POST(request: Request) {
  try {
    const { name, type, statementCloseDay, paymentDay } = await request.json();
    if (!name?.trim() || !type) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!['chequing', 'credit_card', 'line_of_credit'].includes(type)) {
      return NextResponse.json({ error: 'Invalid account type' }, { status: 400 });
    }

    const supabase = await createClient();
    const householdId = await getHousehold(supabase);
    if (!householdId) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: account, error } = await supabase
      .from('accounts')
      .insert({
        household_id: householdId,
        name: name.trim(),
        type,
        statement_close_day: statementCloseDay ?? null,
        payment_day: paymentDay ?? null,
      })
      .select('id, name, type, statement_close_day, payment_day')
      .single();

    if (error) {
      console.error('Account create error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ account });
  } catch (error) {
    console.error('Account POST threw:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}