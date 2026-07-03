import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { buildGrid, EnvTx } from '@/lib/envelopeHelpers';

// GET /api/card-envelope/grid?cardId=<uuid>
// Returns the 12-month trailing grid for one card.
// Rows = the card's envelope categories. Columns = last 12 months (oldest → current).
// Read-only, derived entirely from transactions + envelope items via envelopeHelpers.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cardId = url.searchParams.get('cardId');
    if (!cardId) {
      return NextResponse.json({ error: 'cardId required' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });
    const householdId = userRow.household_id as string;

    // Guard: card must belong to this household
    const { data: card } = await supabase
      .from('accounts').select('id').eq('id', cardId).eq('household_id', householdId).single();
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 });

    // Build 12-month list ending with the current calendar month
    const now = new Date();
    const months: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    const rangeStart = `${months[0]}-01`;
    const last = months[months.length - 1];
    const [ly, lm] = last.split('-').map(Number);
    const rangeEnd = lm === 12
      ? `${ly + 1}-01-01`
      : `${ly}-${String(lm + 1).padStart(2, '0')}-01`;

    // Fetch all transactions for this card in the 12-month window
    const { data: rawTxns } = await supabase
      .from('transactions')
      .select('account_id, amount, category_id, type, date, is_bridge')
      .eq('household_id', householdId)
      .eq('account_id', cardId)
      .gte('date', rangeStart)
      .lt('date', rangeEnd);

    // Envelope categories (defines the rows)
    const { data: items } = await supabase
      .from('card_envelope_items')
      .select('category_id, categories(name)')
      .eq('household_id', householdId)
      .eq('account_id', cardId);

    const envelopeCategories = (items ?? []).map((i) => ({
      id: i.category_id as string,
      name: (i.categories as unknown as { name: string } | null)?.name ?? '?',
    }));

    // Monthly goals for this card across the grid window
    const { data: goalRows } = await supabase
      .from('monthly_goals')
      .select('month, card_goal')
      .eq('household_id', householdId)
      .eq('account_id', cardId)
      .gte('month', rangeStart)
      .lt('month', rangeEnd);

    const totalGoals = new Map<string, number | null>(
      (goalRows ?? []).map((g) => [
        (g.month as string).slice(0, 7), // YYYY-MM
        Number(g.card_goal),
      ])
    );

    const grid = buildGrid(
      (rawTxns ?? []) as EnvTx[],
      cardId,
      envelopeCategories,
      months,
      totalGoals
    );

    return NextResponse.json(grid);
  } catch (error) {
    console.error('GET /api/card-envelope/grid error:', error);
    return NextResponse.json({ error: 'Failed to load grid' }, { status: 500 });
  }
}
