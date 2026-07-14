import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { buildGrid, EnvTx, EnvelopeSnapshotItem } from '@/lib/envelopeHelpers';
import { categoryDisplayName } from '@/lib/categoryTranslations';

// GET /api/card-envelope/grid?cardId=<uuid>&locale=en|fr
// Forward-looking grid for one card: current month + next 11. The current
// month shows real actuals (from this month's transactions); future months
// are budget-only — the past doesn't help the decision, so this grid never
// looks backward. Budgets are carried forward per-cell from the nearest
// saved envelope snapshot at or before that month (read-only projection;
// never writes anything).
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cardId = url.searchParams.get('cardId');
    const locale = url.searchParams.get('locale') === 'fr' ? 'fr' : 'en';
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

    // Current month + next 11
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const months: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Only the current month can have real actuals in a forward-looking grid.
    const monthStart = `${currentMonth}-01`;
    const [cy, cm] = currentMonth.split('-').map(Number);
    const nextMonth = cm === 12 ? `${cy + 1}-01-01` : `${cy}-${String(cm + 1).padStart(2, '0')}-01`;

    const { data: rawTxns } = await supabase
      .from('transactions')
      .select('account_id, amount, category_id, type, date, is_bridge')
      .eq('household_id', householdId)
      .eq('account_id', cardId)
      .gte('date', monthStart)
      .lt('date', nextMonth);

    // All envelope-item snapshots ever saved for this card, grouped by month
    // — carried forward per-cell so future columns show the projected plan.
    const { data: itemRows } = await supabase
      .from('card_envelope_items')
      .select('month, category_id, monthly_amount')
      .eq('household_id', householdId)
      .eq('account_id', cardId);

    const itemSnapshotsByMonth = new Map<string, EnvelopeSnapshotItem[]>();
    for (const row of itemRows ?? []) {
      const m = (row.month as string).slice(0, 7);
      const list = itemSnapshotsByMonth.get(m) ?? [];
      list.push({ categoryId: row.category_id as string, monthlyAmount: Number(row.monthly_amount) });
      itemSnapshotsByMonth.set(m, list);
    }

    // All goals ever saved for this card, carried forward the same way.
    const { data: goalRows } = await supabase
      .from('monthly_goals')
      .select('month, card_goal')
      .eq('household_id', householdId)
      .eq('account_id', cardId);

    const goalsByMonth = new Map<string, number>(
      (goalRows ?? []).map((g) => [(g.month as string).slice(0, 7), Number(g.card_goal)])
    );

    // Category names — needed because a category can appear via actual
    // activity (e.g. a refund) without ever having a saved envelope item.
    const { data: categories } = await supabase
      .from('categories')
      .select('id, name, name_fr')
      .eq('household_id', householdId)
      .eq('type', 'expense');

    const categoryNames = new Map(
      (categories ?? []).map((c) => [c.id as string, categoryDisplayName(c, locale)])
    );

    const grid = buildGrid(
      (rawTxns ?? []) as EnvTx[],
      cardId,
      itemSnapshotsByMonth,
      categoryNames,
      months,
      goalsByMonth,
      currentMonth
    );

    return NextResponse.json(grid);
  } catch (error) {
    console.error('GET /api/card-envelope/grid error:', error);
    return NextResponse.json({ error: 'Failed to load grid' }, { status: 500 });
  }
}
