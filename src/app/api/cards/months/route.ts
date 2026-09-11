import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { businessMonth } from '@phare/core';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import { loadEntitlement } from '@/lib/entitlementServer';
import { entitledHorizonEndMonth, HORIZON_MONTHS_FREE, HORIZON_MONTHS_PRO } from '@/lib/entitlement';
import { cardHistoryFloorMonth } from '@/lib/envelopeHelpers';
import { availableMonths } from '@/lib/timelineDisplayHelpers';

// GET /api/cards/months
//
// The months the Cards page picker can reach, for the whole household:
//
//   floor — the earliest statement cycle with a real card transaction OR a
//           saved plan (goal or category budgets), across every credit card,
//           never later than the current month. Queried, not assumed.
//   end   — the entitled horizon: entitledHorizonEndMonth, the SAME function
//           the Timeline's month nav uses (free 3 months, Pro 12).
//
// Replaces the page's old fixed "current − 1 … current + 11" list, which hid
// July 2026 — real, saved history — once September arrived.
//
// Response: { months, floorMonth, currentMonth, horizonEndMonth, isPro,
//             lockedMonthCount }. lockedMonthCount is how many more forward
// months Pro would show (0 for Pro), for the upgrade note at the boundary.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });
    const householdId = userRow.household_id as string;

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const currentMonth = businessMonth(timezone);

    const { data: cards, error: cardsErr } = await supabase
      .from('accounts')
      .select('id, statement_close_day')
      .eq('household_id', householdId)
      .eq('type', 'credit_card');
    if (cardsErr) throw new Error(`accounts read failed: ${cardsErr.message}`);
    const cardList = (cards ?? []) as { id: string; statement_close_day: number | null }[];
    const cardIds = cardList.map((c) => c.id);

    // Each read below THROWS on error rather than falling back: a swallowed
    // failure would quietly move the floor to the current month and hide the
    // family's history, which looks exactly like "you have no history".
    let earliestTxnByCard: { date: string | null; closeDay: number | null }[] = [];
    let snapshotMonths: (string | null)[] = [];
    if (cardIds.length > 0) {
      // Earliest transaction PER CARD — the cycle a date belongs to depends
      // on that card's own close day, so one household-wide minimum date
      // could map to the wrong cycle.
      earliestTxnByCard = await Promise.all(
        cardList.map(async (card) => {
          const { data, error } = await supabase
            .from('transactions')
            .select('date')
            .eq('household_id', householdId)
            .eq('account_id', card.id)
            .order('date', { ascending: true })
            .limit(1)
            .maybeSingle();
          if (error) throw new Error(`transactions read failed: ${error.message}`);
          return { date: (data?.date as string | undefined) ?? null, closeDay: card.statement_close_day ?? null };
        })
      );

      const earliestSnapshot = async (table: 'card_envelope_items' | 'monthly_goals') => {
        const { data, error } = await supabase
          .from(table)
          .select('month')
          .eq('household_id', householdId)
          .in('account_id', cardIds)
          .order('month', { ascending: true })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(`${table} read failed: ${error.message}`);
        return (data?.month as string | undefined) ?? null;
      };
      snapshotMonths = await Promise.all([earliestSnapshot('card_envelope_items'), earliestSnapshot('monthly_goals')]);
    }

    const floorMonth = cardHistoryFloorMonth(earliestTxnByCard, snapshotMonths, currentMonth);

    const entitlement = await loadEntitlement(supabase, householdId);
    const horizonEndMonth = entitledHorizonEndMonth(currentMonth, entitlement.isPro);

    return NextResponse.json({
      months: availableMonths(floorMonth, horizonEndMonth),
      floorMonth,
      currentMonth,
      horizonEndMonth,
      isPro: entitlement.isPro,
      lockedMonthCount: entitlement.isPro ? 0 : HORIZON_MONTHS_PRO - HORIZON_MONTHS_FREE,
    });
  } catch (error) {
    console.error('GET /api/cards/months error:', error);
    return NextResponse.json({ error: 'Failed to load months' }, { status: 500 });
  }
}
