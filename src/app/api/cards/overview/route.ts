import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { totalSpendForCard, envelopeStatus, EnvTx } from '@/lib/envelopeHelpers';

// GET /api/cards/overview?month=YYYY-MM
// The missing third question: which card has room, without opening any
// card. One row per credit card, in creation order, reading the same
// shared envelope math every other card surface uses.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month');
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'Invalid month' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });
    const householdId = userRow.household_id as string;

    // Scope matches the cards page's own card tabs (credit_card only).
    const { data: cards } = await supabase
      .from('accounts')
      .select('id, name, type')
      .eq('household_id', householdId)
      .eq('type', 'credit_card')
      .order('created_at', { ascending: true });

    const cardList = cards ?? [];
    if (cardList.length === 0) return NextResponse.json({ cards: [] });

    const monthStart = `${monthParam}-01`;
    const [y, m] = monthParam.split('-').map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    const rows = await Promise.all(
      cardList.map(async (card) => {
        const [{ data: goalRow }, { data: txns }] = await Promise.all([
          supabase
            .from('monthly_goals')
            .select('card_goal')
            .eq('household_id', householdId)
            .eq('account_id', card.id)
            .lte('month', monthStart)
            .order('month', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('transactions')
            .select('account_id, amount, category_id, type, date, is_bridge')
            .eq('household_id', householdId)
            .eq('account_id', card.id)
            .gte('date', monthStart)
            .lt('date', nextMonth),
        ]);

        const goal = goalRow ? Number(goalRow.card_goal) : null;
        const spent = totalSpendForCard((txns ?? []) as EnvTx[], card.id, monthParam);

        return {
          id: card.id,
          name: card.name,
          goal,
          spent,
          remaining: goal !== null ? Math.round((goal - spent) * 100) / 100 : null,
          status: envelopeStatus(goal ?? 0, spent),
        };
      })
    );

    return NextResponse.json({ month: monthParam, cards: rows });
  } catch (error) {
    console.error('GET /api/cards/overview error:', error);
    return NextResponse.json({ error: 'Failed to load cards overview' }, { status: 500 });
  }
}
