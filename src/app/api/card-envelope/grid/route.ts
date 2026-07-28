import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { buildGrid, EnvTx, EnvelopeSnapshotItem } from '@/lib/envelopeHelpers';
import { categoryDisplayName } from '@/lib/categoryTranslations';
import { businessMonth, businessToday, statementCycleWindow } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

// GET /api/card-envelope/grid?cardId=<uuid>&locale=en|fr
// Forward-looking grid for one card: current cycle + next 11. The current
// cycle shows real actuals (from this cycle's transactions); future cycles
// are budget-only — the past doesn't help the decision, so this grid never
// looks backward. Budgets are carried forward per-cell from the nearest
// saved envelope snapshot at or before that month (read-only projection;
// never writes anything). Statement-cycle scoping (2026-07-31): "current"
// means the cycle whose window contains today, not merely the calendar
// month — see envelopeHelpers.buildGrid's isFuture, which is day-aware for
// exactly this reason.
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

    // Guard: card must belong to this household. statement_close_day is
    // fetched here too — threaded to every cycle computation below.
    const { data: card } = await supabase
      .from('accounts').select('id, statement_close_day').eq('id', cardId).eq('household_id', householdId).single();
    if (!card) return NextResponse.json({ error: 'Card not found' }, { status: 404 });
    const closeDay = (card.statement_close_day as number | null) ?? null;

    // Current month + next 11
    const timezone = await getHouseholdTimezone(supabase, householdId);
    const currentMonth = businessMonth(timezone);
    const today = businessToday(timezone);
    const [cy0, cm0] = currentMonth.split('-').map(Number);
    const months: string[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(cy0, cm0 - 1 + i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Only the currently-open cycle(s) can have real actuals in a
    // forward-looking grid. Fetch from the current calendar month's cycle
    // window through the NEXT calendar month's cycle window — near a
    // close-day boundary, the cycle labeled with next month may already have
    // started (see buildGrid's isFuture), so both windows are covered rather
    // than assuming only `currentMonth`'s window can ever be "live."
    const rangeStart = statementCycleWindow(months[0], closeDay).start;
    const rangeEnd = statementCycleWindow(months[1], closeDay).end;

    const { data: rawTxns } = await supabase
      .from('transactions')
      .select('account_id, amount, category_id, type, date, is_bridge')
      .eq('household_id', householdId)
      .eq('account_id', cardId)
      .gte('date', rangeStart)
      .lte('date', rangeEnd);

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
      currentMonth,
      closeDay,
      today
    );

    return NextResponse.json(grid);
  } catch (error) {
    console.error('GET /api/card-envelope/grid error:', error);
    return NextResponse.json({ error: 'Failed to load grid' }, { status: 500 });
  }
}
