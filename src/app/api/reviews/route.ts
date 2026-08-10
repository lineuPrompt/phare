import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { computeMonthTotals, type TxRow, type AccountRow } from '@/lib/dashboardHelpers';
import { loadEntitlement } from '@/lib/entitlementServer';
import {
  groupReviewArchive,
  monthsNeedingFigures,
  type ArchiveConversation,
} from '@/lib/reviewArchive';

// ---------------------------------------------------------------------------
// GET /api/reviews — every letter this household has, for the Reviews page.
//
// THE PAYWALL IS ENFORCED HERE, not in the component. groupReviewArchive runs
// each letter through reviewForEntitlement, so a free household's response
// contains the opening of each review and nothing else — the rest is absent
// from the payload, not hidden in it. Same doctrine as the dashboard: anything
// less is a CSS effect defeated from the network tab.
//
// WHAT IS *NOT* GATED, deliberately:
//   - the LIST itself (months, dates, figures). Those are the household's own
//     ledger, and proGate's header is explicit that reading existing data is
//     never gated. Showing a free household that six letters exist is also a
//     better paywall than hiding them: it sells the thing being sold.
//   - every topRecommendation, for the reason the dashboard already gives —
//     it is the daily value of the free tier.
//
// THE ONBOARDING LETTER IS GATED LIKE THE REST, and that is a deliberate match
// to existing behaviour rather than an oversight. The dashboard already runs
// whatever letter it shows — onboarding included, since it picks the newest of
// ('onboarding','monthly_review') — through reviewForEntitlement. Un-gating it
// only here would mean a free household sees the same letter truncated on the
// dashboard and complete on this page, which is a paywall hole rather than a
// generosity. (proGate's "the onboarding plan itself" refers to GENERATING a
// plan without paying, which free households do; it is not about full-text
// display.)
//
// THE FIGURES ARE COMPUTED, NEVER PARSED. Each month's net cash flow comes from
// computeMonthTotals over that month's real transactions — the same helper the
// dashboard uses. Reading a number out of the letter's prose would make the
// figure a restatement of what the model said rather than an independent check
// on it, which is the entire reason it is shown next to the letter.
// ---------------------------------------------------------------------------

/** 'YYYY-MM' → the exclusive upper bound '(YYYY+1)-01-01' or 'YYYY-(MM+1)-01'. */
function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

export async function GET() {
  try {
    const supabase = await createClient();

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();

    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }
    const householdId = userRow.household_id;

    const { data: conversations, error: convErr } = await supabase
      .from('conversations')
      .select('id, type, review_month, created_at, messages')
      .eq('household_id', householdId)
      .in('type', ['onboarding', 'monthly_review'])
      .order('created_at', { ascending: false });

    if (convErr) {
      console.error('Reviews — could not list conversations:', convErr);
      return NextResponse.json({ error: 'Could not load your reviews' }, { status: 503 });
    }

    const rows = (conversations ?? []) as ArchiveConversation[];
    const months = monthsNeedingFigures(rows);

    // ---- Ledger figures, one query spanning every month that needs one -----
    const figures: Record<string, number | null> = {};

    if (months.length > 0) {
      const { data: rawAccounts } = await supabase
        .from('accounts')
        .select('id, type, is_sinking_fund')
        .eq('household_id', householdId);
      const accounts = (rawAccounts ?? []) as AccountRow[];

      // One range covering the earliest month through the latest, rather than
      // a query per month. `months` is sorted ascending by monthsNeedingFigures.
      const { data: rawTx } = await supabase
        .from('transactions')
        .select('id, amount, type, account_id, transfer_peer_id, date')
        .eq('household_id', householdId)
        .gte('date', `${months[0]}-01`)
        .lt('date', monthEnd(months[months.length - 1]));

      const txByMonth = new Map<string, TxRow[]>();
      for (const tx of (rawTx ?? []) as (TxRow & { date: string })[]) {
        const key = tx.date.slice(0, 7);
        const list = txByMonth.get(key) ?? [];
        list.push(tx);
        txByMonth.set(key, list);
      }

      for (const month of months) {
        const monthTx = txByMonth.get(month);
        // No rows is NOT zero. A month with no ledger data has no net cash
        // flow to report, and $0 would read as "it broke even".
        figures[month] = monthTx?.length
          ? computeMonthTotals(monthTx, accounts).netCashFlow
          : null;
      }
    }

    const entitlement = await loadEntitlement(supabase, householdId);
    const archive = groupReviewArchive(rows, { isPro: entitlement.isPro, figures });

    return NextResponse.json({ ...archive, isPro: entitlement.isPro });
  } catch (err) {
    console.error('Reviews — request threw:', err);
    return NextResponse.json({ error: 'Could not load your reviews' }, { status: 500 });
  }
}
