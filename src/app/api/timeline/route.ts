import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  selectAnchorsForTimeline,
  buildCashTimeline,
  type TimelineAnchor,
  type TimelineTx,
} from '@/lib/timelineHelpers';
import { groupUnbalancedTransactions } from '@/lib/timelineDisplayHelpers';
import { ensureBridgesForWindow } from '@/lib/bridgeHelpers';
import { loadEntitlement } from '@/lib/entitlementServer';
import { HORIZON_MONTHS_FREE, HORIZON_MONTHS_PRO } from '@/lib/entitlement';
import { businessToday } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import { logEvent } from '@/lib/eventLogger';
import { addMonthsToMonth } from '@/lib/goalHelpers';
import {
  buildPlanChain,
  type ChequingChainTx,
  type PlanChainMonth,
} from '@/lib/planChainHelpers';

const TRANSACTION_COLUMNS =
  'id, date, description, amount, type, recurring_item_id, recurrence_id, installment_label, transfer_peer_id, is_bridge, bridge_source_account, bridge_source_month';
const VALID_TX_TYPES = new Set(['income', 'expense', 'transfer']);

function toTimelineTxs(rows: Record<string, unknown>[]): TimelineTx[] {
  return rows
    .filter((t) => VALID_TX_TYPES.has(String(t.type)))
    .map((t) => ({
      id: t.id as string,
      date: t.date as string,
      description: (t.description ?? null) as string | null,
      amount: Number(t.amount),
      type: t.type as 'income' | 'expense' | 'transfer',
      recurringItemId: (t.recurring_item_id ?? null) as string | null,
      recurrenceId: (t.recurrence_id ?? null) as string | null,
      installmentLabel: (t.installment_label ?? null) as string | null,
      transferPeerId: (t.transfer_peer_id ?? null) as string | null,
      isBridge: Boolean(t.is_bridge),
      bridgeSourceAccount: (t.bridge_source_account ?? null) as string | null,
      bridgeSourceMonth: (t.bridge_source_month ?? null) as string | null,
    }));
}

// GET /api/timeline?account=<chequingId>[&windowStart=<YYYY-MM-01>]
//
// Returns a running-balance timeline. Default window: today's month through
// today+11 months (matching the materialized recurring-item/bridge range).
// `windowStart` optionally pulls the start of the window earlier — e.g. to
// the earliest account_balance_anchor's month — for the Cash Timeline page's
// month-by-month navigation, fetched once per page load rather than per month.
// Single query per resource type — no per-month round trips.
//
// Response shape matches TimelineResult from timelineHelpers.ts, plus one
// additive field:
//   { ok: true, balancesStartDate, openingBalance, closingBalance, todayBalance,
//     days, dip, nextIncomeDate, unbalancedDays }
//   { ok: false, reason: 'no_anchor' }
//
// unbalancedDays: real transactions strictly before balancesStartDate but at
// or after windowStart — the mid-window-first-anchor case, where a day has
// entries but no known balance. [] when there's nothing to show (the normal
// case). Existing consumers that don't read this field are unaffected.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('account');
    if (!accountId) {
      return NextResponse.json({ error: 'Missing account param' }, { status: 400 });
    }
    const windowStartParam = url.searchParams.get('windowStart');
    if (windowStartParam && !/^\d{4}-\d{2}-01$/.test(windowStartParam)) {
      return NextResponse.json({ error: 'Invalid windowStart param (expected YYYY-MM-01)' }, { status: 400 });
    }
    // Distinguishes a genuine Timeline PAGE load from the dashboard's own
    // call to this same endpoint (the dip tile) — only the Timeline page
    // sends this. See eventLogger.ts's FUNNEL INSTRUMENTATION note.
    const isPageView = url.searchParams.get('pageView') === '1';
    // The chained 12-month plan (planChainHelpers.ts) is several extra
    // queries — opt-in so the dashboard's lightweight dip-tile call to this
    // same endpoint doesn't pay for it.
    const includePlan = url.searchParams.get('includePlan') === '1';

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id as string;

    if (isPageView) {
      void logEvent(supabase, householdId, user.id, 'timeline_opened');
    }

    const { data: account } = await supabase
      .from('accounts')
      .select('id, type')
      .eq('id', accountId)
      .eq('household_id', householdId)
      .single();
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (account.type !== 'chequing') {
      return NextResponse.json({ error: 'Only chequing accounts support timeline' }, { status: 400 });
    }
    const chequingId = account.id as string;

    const { data: memberRow } = await supabase
      .from('household_members').select('id').eq('household_id', householdId).eq('user_id', user.id).single();
    const memberId = (memberRow?.id ?? null) as string | null;

    // ── 12-month window ────────────────────────────────────────────────────────

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const today = businessToday(timezone);
    const [ty, tm] = today.split('-').map(Number);

    // defaultWindowStart: first day of today's month
    const defaultWindowStart = `${ty}-${String(tm).padStart(2, '0')}-01`;

    // windowEnd: last day of (today's month + 11 months). Materialization is
    // always pinned to today's month regardless of windowStart navigation.
    const weRaw = (tm - 1) + 11; // 0-indexed month index, may exceed 11
    const weYear = ty + Math.floor(weRaw / 12);
    const weMonth = (weRaw % 12) + 1;
    const weLastDay = new Date(weYear, weMonth, 0).getDate();
    const windowEnd = `${weYear}-${String(weMonth).padStart(2, '0')}-${String(weLastDay).padStart(2, '0')}`;

    // windowStart: caller may pull this earlier (e.g. to the earliest anchor's
    // month) for month-navigation; never later than the default.
    const windowStart =
      windowStartParam && windowStartParam < defaultWindowStart ? windowStartParam : defaultWindowStart;

    // ── Bridge: ensure credit card payment rows exist ───────────────────────────
    // A bridge payment for spend month M appears in the chequing ledger in month M+1.
    // The 12 payment months in the window (windowStart..windowEnd) correspond to
    // 12 spend months: [windowStart month − 1 ... windowEnd month − 1].

    const { data: cardAccounts } = await supabase
      .from('accounts')
      .select('id, name, payment_day, statement_close_day')
      .eq('household_id', householdId)
      .eq('type', 'credit_card');

    const cards = (cardAccounts ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
      payment_day: (a.payment_day ?? null) as number | null,
      statement_close_day: (a.statement_close_day ?? null) as number | null,
    }));

    const spendMonths: string[] = [];
    for (let i = 0; i < 12; i++) {
      // rawIdx: 0-indexed month offset from Jan of ty.
      // tm-2 = one month before windowStart (0-indexed). Handles Jan (tm=1) → -1 correctly:
      //   Math.floor(-1/12) = -1, ((-1%12)+12)%12 = 11 → December of previous year.
      const rawIdx = (tm - 2) + i;
      const smy = ty + Math.floor(rawIdx / 12);
      const smm = ((rawIdx % 12) + 12) % 12 + 1;
      spendMonths.push(`${smy}-${String(smm).padStart(2, '0')}`);
    }

    await ensureBridgesForWindow({ supabase, householdId, chequingId, memberId, cards, spendMonths });

    // ── Anchors ────────────────────────────────────────────────────────────────
    // Fetch all anchors up to windowEnd; selectAnchorsForTimeline picks the ones
    // the algorithm needs (latest pre-window anchor + in-window corrective anchors).

    const { data: rawAnchors } = await supabase
      .from('account_balance_anchors')
      .select('anchor_date, balance')
      .eq('account_id', chequingId)
      .eq('household_id', householdId)
      .lte('anchor_date', windowEnd)
      .order('anchor_date', { ascending: true });

    const allAnchors: TimelineAnchor[] = (rawAnchors ?? []).map((a) => ({
      date: a.anchor_date as string,
      balance: Number(a.balance),
    }));

    const anchors = selectAnchorsForTimeline(allAnchors, windowStart, windowEnd);

    if (anchors.length === 0) {
      return NextResponse.json({ ok: false, reason: 'no_anchor' });
    }

    // ── Transactions ───────────────────────────────────────────────────────────
    // Fetch from the earliest anchor's date (anchors[0].date, which may precede
    // windowStart) through windowEnd. This gives buildCashTimeline the pre-window
    // transactions it needs to derive openingBalance when the anchor is before the window.

    const fetchStart = anchors[0].date;

    const { data: rawTxns } = await supabase
      .from('transactions')
      .select(TRANSACTION_COLUMNS)
      .eq('household_id', householdId)
      .eq('account_id', chequingId)
      .gte('date', fetchStart)
      .lte('date', windowEnd)
      .order('date', { ascending: true });

    const transactions: TimelineTx[] = toTimelineTxs(rawTxns ?? []);

    // ── Build ──────────────────────────────────────────────────────────────────

    const result = buildCashTimeline({ anchors, transactions, windowStart, windowEnd, today });

    // ── Unbalanced days: mid-window first anchor ────────────────────────────────
    // Real entries between windowStart and balancesStartDate that buildCashTimeline
    // deliberately omits (no known balance to attach them to). Fetched separately
    // since they fall before fetchStart (= anchors[0].date = balancesStartDate here).

    let unbalancedDays: ReturnType<typeof groupUnbalancedTransactions> = [];
    if (result.ok && result.balancesStartDate > windowStart) {
      const { data: rawPreAnchorTxns } = await supabase
        .from('transactions')
        .select(TRANSACTION_COLUMNS)
        .eq('household_id', householdId)
        .eq('account_id', chequingId)
        .gte('date', windowStart)
        .lt('date', result.balancesStartDate)
        .order('date', { ascending: true });

      unbalancedDays = groupUnbalancedTransactions(
        toTimelineTxs(rawPreAnchorTxns ?? []),
        windowStart,
        result.balancesStartDate
      );
    }

    // ── The chained 12-month plan (opt-in, planChainHelpers.ts) ─────────────────
    // Anchors at result.todayBalance (real balance as of today — never
    // recomputed here) and chains forward using exactly two inputs: every
    // dated chequing row at its real signed value (income/expense/transfer
    // alike — see planChainHelpers.ts's THE MODEL note), and per-card cost
    // (closed/open/max, reusing computeCardEnvelopeRemainders unchanged).
    // horizonAvailable is what was COMPUTED (always 12); horizonMonths is what
    // is RETURNED. They differ only for a free household, and the gap is what
    // the lock UI reports honestly rather than guessing at.
    let plan: {
      months: PlanChainMonth[];
      horizonMonths: number;
      horizonLocked: boolean;
      horizonAvailable: number;
    } | null = null;

    if (includePlan && result.ok && result.todayBalance !== null) {
      const currentMonth = today.slice(0, 7);

      // Dated basis: the SAME chequing transactions already fetched for the
      // real walk above (fetchStart..windowEnd) — no second query.
      // planChainHelpers excludes only is_bridge itself.
      const datedTransactions: ChequingChainTx[] = transactions.map((t) => ({
        account_id: chequingId,
        date: t.date,
        type: t.type,
        amount: t.amount,
        recurring_item_id: t.recurringItemId,
        is_bridge: t.isBridge,
      }));

      // Card budgets/actuals across the whole 12-month plan horizon. Cards
      // were already resolved above for bridge-ensuring; reused as-is.
      let cardBudgetRows: { account_id: string; card_goal: number; month: string }[] = [];
      let cardTxRows: { account_id: string; date: string; type: string; amount: number }[] = [];
      if (cards.length > 0) {
        const cardIds = cards.map((c) => c.id);
        // Latest cycle month the chain ever needs: month 12's relevant cycle
        // is (currentMonth + 11) − 1 = currentMonth + 10.
        const latestCycleMonth = addMonthsToMonth(currentMonth, 10);

        const [{ data: goalRows }, { data: cardTxns }] = await Promise.all([
          supabase
            .from('monthly_goals')
            .select('account_id, card_goal, month')
            .eq('household_id', householdId)
            .in('account_id', cardIds)
            .lte('month', `${latestCycleMonth}-01`),
          supabase
            .from('transactions')
            .select('account_id, date, type, amount')
            .eq('household_id', householdId)
            .in('account_id', cardIds)
            .in('type', ['expense', 'income'])
            // A close_day near month-start can push a cycle's window back
            // close to a month early — 2 months of slack is generous.
            .gte('date', `${addMonthsToMonth(currentMonth, -2)}-01`)
            .lte('date', windowEnd),
        ]);

        cardBudgetRows = (goalRows ?? []).map((r) => ({
          account_id: r.account_id as string, card_goal: Number(r.card_goal), month: r.month as string,
        }));
        cardTxRows = (cardTxns ?? []).map((r) => ({
          account_id: r.account_id as string, date: r.date as string, type: r.type as string, amount: Number(r.amount),
        }));
      }

      // Unanchored recurring items disclosed per month (all months equally
      // affected — a never-anchored rule materializes into none of them,
      // see planChainHelpers.ts / dashboard's own existing disclosure).
      const [{ count: unanchoredIncomeCount }, { count: unanchoredExpenseCount }] = await Promise.all([
        supabase.from('recurring_items').select('id', { count: 'exact', head: true })
          .eq('household_id', householdId).eq('type', 'income').eq('active', true).is('anchor_date', null),
        supabase.from('recurring_items').select('id', { count: 'exact', head: true })
          .eq('household_id', householdId).eq('type', 'expense').eq('active', true).is('anchor_date', null),
      ]);

      const months = buildPlanChain({
        anchorBalance: result.todayBalance,
        today,
        currentMonth,
        monthsAhead: 12,
        chequingId,
        datedTransactions,
        cards,
        cardBudgetRows,
        cardTransactions: cardTxRows,
        unanchoredIncomeCount: unanchoredIncomeCount ?? 0,
        unanchoredExpenseCount: unanchoredExpenseCount ?? 0,
      });

      // ── Horizon gate ─────────────────────────────────────────────────────
      // buildPlanChain ALWAYS computes the full 12 months above, and the
      // bridge materialisation window above is likewise never shortened. Only
      // what is RETURNED is trimmed.
      //
      // That separation is deliberate and load-bearing. ensureBridgesForWindow
      // creates real transaction rows, and the dashboard materialises the same
      // 12-month window independently — shrinking the computation for free
      // households would change which bridge rows exist in the database, so a
      // free household's ledger would differ from a Pro one's. A paywall must
      // change what someone SEES, never what their data IS.
      //
      // Computing all 12 and slicing also lets the lock state say honestly how
      // many further months exist, without a second pass.
      const entitlement = await loadEntitlement(supabase, householdId);
      const allowedMonths = entitlement.isPro ? HORIZON_MONTHS_PRO : HORIZON_MONTHS_FREE;
      plan = {
        months: months.slice(0, allowedMonths),
        horizonMonths: allowedMonths,
        horizonLocked: months.length > allowedMonths,
        horizonAvailable: months.length,
      };
    }

    return NextResponse.json(result.ok ? { ...result, unbalancedDays, plan } : result);
  } catch (error) {
    console.error('Timeline GET error:', error);
    return NextResponse.json({ error: 'Failed to load timeline' }, { status: 500 });
  }
}
