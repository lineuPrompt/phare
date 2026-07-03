import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import {
  selectAnchorsForTimeline,
  buildCashTimeline,
  type TimelineAnchor,
  type TimelineTx,
} from '@/lib/timelineHelpers';
import { ensureBridgesForWindow } from '@/lib/bridgeHelpers';

// GET /api/timeline?account=<chequingId>
//
// Returns a 12-month running-balance timeline: today's month through today+11 months.
// Single query per resource type — no per-month round trips.
//
// Response shape matches TimelineResult from timelineHelpers.ts:
//   { ok: true, balancesStartDate, openingBalance, closingBalance, todayBalance, days, dip, nextIncomeDate }
//   { ok: false, reason: 'no_anchor' }
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('account');
    if (!accountId) {
      return NextResponse.json({ error: 'Missing account param' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id as string;

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

    const today = new Date().toISOString().slice(0, 10);
    const [ty, tm] = today.split('-').map(Number);

    // windowStart: first day of today's month
    const windowStart = `${ty}-${String(tm).padStart(2, '0')}-01`;

    // windowEnd: last day of (today's month + 11 months)
    const weRaw = (tm - 1) + 11; // 0-indexed month index, may exceed 11
    const weYear = ty + Math.floor(weRaw / 12);
    const weMonth = (weRaw % 12) + 1;
    const weLastDay = new Date(weYear, weMonth, 0).getDate();
    const windowEnd = `${weYear}-${String(weMonth).padStart(2, '0')}-${String(weLastDay).padStart(2, '0')}`;

    // ── Bridge: ensure credit card payment rows exist ───────────────────────────
    // A bridge payment for spend month M appears in the chequing ledger in month M+1.
    // The 12 payment months in the window (windowStart..windowEnd) correspond to
    // 12 spend months: [windowStart month − 1 ... windowEnd month − 1].

    const { data: cardAccounts } = await supabase
      .from('accounts')
      .select('id, name, payment_day')
      .eq('household_id', householdId)
      .eq('type', 'credit_card');

    const cards = (cardAccounts ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
      payment_day: (a.payment_day ?? null) as number | null,
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
      .select(
        'id, date, description, amount, type, ' +
        'recurring_item_id, recurrence_id, installment_label, ' +
        'transfer_peer_id, is_bridge, bridge_source_account'
      )
      .eq('household_id', householdId)
      .eq('account_id', chequingId)
      .gte('date', fetchStart)
      .lte('date', windowEnd)
      .order('date', { ascending: true });

    const validTypes = new Set(['income', 'expense', 'transfer']);
    const transactions: TimelineTx[] = (rawTxns ?? [])
      .filter((t) => validTypes.has(String(t.type)))
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
      }));

    // ── Build and return ───────────────────────────────────────────────────────

    const result = buildCashTimeline({ anchors, transactions, windowStart, windowEnd, today });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Timeline GET error:', error);
    return NextResponse.json({ error: 'Failed to load timeline' }, { status: 500 });
  }
}
