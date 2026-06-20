import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { groupPlannerSections, PlannerTxRow } from '@/lib/plannerHelpers';
import { bridgePaymentDate } from '@/lib/dateHelpers';
import { logEvent } from '@/lib/eventLogger';

/**
 * GET /api/planner?month=YYYY-MM
 *
 * Returns the three planner sections (income, expenses, savings) and bucket
 * totals for the given month, derived exclusively from the chequing-account
 * ledger.  Triggers bridge generation so card spending appears as a payment
 * line before the data is read.
 *
 * Remaining cash = totals.netCashFlow (income − expenses − savings).
 * computeMonthTotals (inside groupPlannerSections) is the single source of
 * truth for all bucket math — no parallel calculation here.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const monthParam = url.searchParams.get('month');
    if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
      return NextResponse.json({ error: 'Invalid month (expected YYYY-MM)' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    const { data: memberRow } = await supabase
      .from('household_members').select('id')
      .eq('household_id', householdId).eq('user_id', user.id).single();
    const memberId = memberRow?.id ?? null;

    // Diary: planner view heartbeat (every load)
    await logEvent(supabase, householdId, user.id, 'viewed_planner', { month: monthParam });

    // Month bounds
    const [y, m] = monthParam.split('-').map(Number);
    const monthStart = `${monthParam}-01`;
    const monthEnd = m === 12
      ? `${y + 1}-01-01`
      : `${y}-${String(m + 1).padStart(2, '0')}-01`;

    // Load all accounts (needed for bridge generation + groupPlannerSections)
    const { data: accountsData } = await supabase
      .from('accounts')
      .select('id, name, type, payment_day')
      .eq('household_id', householdId);
    const accountList = accountsData ?? [];

    const chequing = accountList.find((a) => a.type === 'chequing') ?? null;
    if (!chequing) {
      return NextResponse.json({ error: 'No chequing account found' }, { status: 400 });
    }

    // -----------------------------------------------------------------------
    // Bridge generation — same idempotent pattern as /api/expenses.
    // Creates a chequing payment line for each credit card's prior-month spend
    // if one doesn't already exist.  Safe to call on every planner load.
    // -----------------------------------------------------------------------
    const prevMonthIndex = (m - 1) - 1;
    const prevYear = y + Math.floor(prevMonthIndex / 12);
    const prevMonth0 = ((prevMonthIndex % 12) + 12) % 12;
    const prevMonth = `${prevYear}-${String(prevMonth0 + 1).padStart(2, '0')}`;
    const prevStart = `${prevMonth}-01`;
    const prevEnd = monthStart;

    const cards = accountList.filter((a) => a.type === 'credit_card');
    for (const card of cards) {
      const { data: cardTxns } = await supabase
        .from('transactions').select('amount')
        .eq('household_id', householdId)
        .eq('account_id', card.id)
        .eq('type', 'expense')
        .gte('date', prevStart)
        .lt('date', prevEnd);

      const total = Math.round(
        ((cardTxns ?? []).reduce((s, t) => s + Number(t.amount), 0)) * 100
      ) / 100;

      if (total <= 0) continue;

      const { data: existing } = await supabase
        .from('transactions').select('id')
        .eq('household_id', householdId)
        .eq('is_bridge', true)
        .eq('bridge_source_account', card.id)
        .eq('bridge_source_month', prevMonth)
        .maybeSingle();

      if (!existing) {
        await supabase.from('transactions').insert({
          household_id: householdId,
          member_id: memberId,
          account_id: chequing.id,
          category_id: null,
          amount: total,
          description: `${card.name} payment`,
          date: bridgePaymentDate(prevMonth, card.payment_day ?? 1),
          type: 'expense',
          source: 'bridge',
          is_bridge: true,
          bridge_source_account: card.id,
          bridge_source_month: prevMonth,
        });
      }
    }

    // -----------------------------------------------------------------------
    // Fetch all chequing-side transactions for the month.
    // Selecting transfer_peer_id so we can resolve goal account names below.
    // -----------------------------------------------------------------------
    const { data: txnsData } = await supabase
      .from('transactions')
      .select('id, date, description, amount, type, account_id, transfer_peer_id')
      .eq('household_id', householdId)
      .eq('account_id', chequing.id)
      .gte('date', monthStart)
      .lt('date', monthEnd)
      .order('date', { ascending: true });

    const rawTxns = txnsData ?? [];

    // -----------------------------------------------------------------------
    // Resolve goal account names for chequing-side transfer rows.
    // Approach: transfer_peer_id → peer transaction row → peer account_id → account name.
    // -----------------------------------------------------------------------
    const peerIds = rawTxns
      .filter((t) => t.type === 'transfer' && t.transfer_peer_id)
      .map((t) => t.transfer_peer_id as string);

    // Map: peer transaction id → account_id
    const peerAccountMap = new Map<string, string>();
    if (peerIds.length > 0) {
      const { data: peerRows } = await supabase
        .from('transactions').select('id, account_id')
        .in('id', peerIds);
      for (const p of peerRows ?? []) {
        if (p.account_id) peerAccountMap.set(p.id, p.account_id);
      }
    }

    // Map: account_id → account name
    const accountNameById = new Map(accountList.map((a) => [a.id, a.name]));

    // Attach goalAccountName to each chequing-side transfer row
    const plannerTxns: PlannerTxRow[] = rawTxns.map((t) => {
      let goalAccountName: string | undefined;
      if (t.type === 'transfer' && t.transfer_peer_id) {
        const peerAcctId = peerAccountMap.get(t.transfer_peer_id);
        if (peerAcctId) goalAccountName = accountNameById.get(peerAcctId);
      }
      return {
        id: t.id,
        amount: t.amount,
        type: t.type,
        account_id: t.account_id,
        description: t.description ?? null,
        date: t.date,
        goalAccountName,
      };
    });

    // groupPlannerSections calls computeMonthTotals internally — single source
    // of truth for all bucket math.
    const grouped = groupPlannerSections(plannerTxns, accountList);

    return NextResponse.json({
      month: monthParam,
      ...grouped,
    });
  } catch (error) {
    console.error('Planner GET error:', error);
    return NextResponse.json({ error: 'Failed to load planner' }, { status: 500 });
  }
}
