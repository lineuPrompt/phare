import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { buildGrid, gridWindowMonths, EnvTx, EnvelopeSnapshotItem } from '@/lib/envelopeHelpers';
import { categoryDisplayName } from '@/lib/categoryTranslations';
import { businessMonth, businessToday, statementCycleWindow } from '@phare/core';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import { loadEntitlement } from '@/lib/entitlementServer';
import { entitledHorizonEndMonth } from '@/lib/entitlement';

// GET /api/card-envelope/grid?cardId=<uuid>&locale=en|fr[&month=YYYY-MM]
//
// Month-by-month grid for one card. The window follows the month picked on
// the Cards page (gridWindowMonths): current or future picked → today's
// forward window; past picked → up to 12 columns starting there. Never past
// the household's entitled horizon — the same entitledHorizonEndMonth the
// Timeline uses. `month` omitted = current month, the old default.
//
// Closed cycles show real actuals against that month's own saved snapshot;
// the open cycle shows real actuals against the carried-forward plan; future
// cycles are budget-only, carried forward (see envelopeHelpers.buildGrid).
// Statement-cycle scoping (2026-07-31): "current" means the cycle whose
// window contains today, not merely the calendar month.
//
// Reverses the 2026-07 "this grid never looks backward" decision, at the
// founder's request (2026-09-11): past months are where real spend lives.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const cardId = url.searchParams.get('cardId');
    const locale = url.searchParams.get('locale') === 'fr' ? 'fr' : 'en';
    const monthParam = url.searchParams.get('month');
    if (!cardId) {
      return NextResponse.json({ error: 'cardId required' }, { status: 400 });
    }
    if (monthParam !== null && !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'Invalid month (expected YYYY-MM)' }, { status: 400 });
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

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const currentMonth = businessMonth(timezone);
    const today = businessToday(timezone);
    const entitlement = await loadEntitlement(supabase, householdId);
    const horizonEndMonth = entitledHorizonEndMonth(currentMonth, entitlement.isPro);
    const months = gridWindowMonths(monthParam ?? currentMonth, currentMonth, horizonEndMonth);

    // Fetch EVERY rendered column's full cycle window: from the first
    // column's cycle start to the last column's cycle end. Consecutive cycle
    // windows are contiguous, so this covers each column completely.
    //
    // This is load-bearing, not an optimisation detail. buildGrid gives any
    // non-future column a real number, so a closed column whose transactions
    // were never fetched reads $0 — a plausible, wrong figure. The old fetch
    // (current + next cycle only) was safe only because the grid never had a
    // past column; see the regression test in __tests__/pastWindow.test.ts.
    const rangeStart = statementCycleWindow(months[0], closeDay).start;
    const rangeEnd = statementCycleWindow(months[months.length - 1], closeDay).end;

    const { data: rawTxns, error: txnErr } = await supabase
      .from('transactions')
      .select('account_id, amount, category_id, type, date, is_bridge')
      .eq('household_id', householdId)
      .eq('account_id', cardId)
      .gte('date', rangeStart)
      .lte('date', rangeEnd);
    // A failed read must not render as a grid of real-looking $0 actuals.
    if (txnErr) throw new Error(`grid transactions read failed: ${txnErr.message}`);

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
