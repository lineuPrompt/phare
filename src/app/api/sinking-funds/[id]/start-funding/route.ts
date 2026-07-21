import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { businessToday, materializeFromMonthStart } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import { materializeTransferOccurrences } from '@/lib/recurringTransferHelpers';

/**
 * POST /api/sinking-funds/[id]/start-funding
 *
 * Turns a dead sinking-fund provision into a real cash buffer (Build 4
 * Part 2, 2026-07-21): creates a 'savings' account flagged is_sinking_fund
 * (reusing GOAL_ACCOUNT_TYPES machinery — a fund is a transfer destination
 * exactly like a real savings goal, no new account-type/RPC change needed),
 * links the sinking_funds row to it, and sets up a recurring monthly
 * transfer at the fund's own provision amount via the SAME materialization
 * mechanism recurring contributions already use (create_transfer RPC, one
 * call per occurrence). Nothing here is a parallel store — the fund's
 * balance going forward is just computeGoalBalance() on this account's own
 * ledger, same as every goal/debt.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: fundId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });
    const householdId = userRow.household_id;

    const { data: member } = await supabase
      .from('household_members').select('id')
      .eq('household_id', householdId).eq('user_id', user.id).single();
    if (!member) return NextResponse.json({ error: 'No member record' }, { status: 400 });

    const { data: fund } = await supabase
      .from('sinking_funds')
      .select('id, name, monthly_provision, linked_account_id')
      .eq('id', fundId)
      .eq('household_id', householdId)
      .single();
    if (!fund) return NextResponse.json({ error: 'Sinking fund not found' }, { status: 404 });
    if (fund.linked_account_id) {
      return NextResponse.json({ error: 'This fund is already being funded' }, { status: 400 });
    }

    const { data: chequing } = await supabase
      .from('accounts')
      .select('id')
      .eq('household_id', householdId)
      .eq('type', 'chequing')
      .single();
    if (!chequing) return NextResponse.json({ error: 'No chequing account found' }, { status: 400 });

    // New accounts append after everything the household already has —
    // same sort_order contract as POST /api/accounts.
    const { data: existingAccounts } = await supabase
      .from('accounts')
      .select('sort_order')
      .eq('household_id', householdId);
    const nextSortOrder = (existingAccounts ?? []).reduce((m, a) => Math.max(m, a.sort_order ?? 0), 0) + 1;

    const { data: account, error: acctError } = await supabase
      .from('accounts')
      .insert({
        household_id: householdId,
        name: fund.name,
        type: 'savings',
        is_sinking_fund: true,
        sort_order: nextSortOrder,
      })
      .select('id, name, type')
      .single();
    if (acctError || !account) {
      console.error('Sinking fund account create error:', acctError);
      return NextResponse.json({ error: acctError?.message || 'Failed to create fund account' }, { status: 500 });
    }

    const { error: linkError } = await supabase
      .from('sinking_funds')
      .update({ linked_account_id: account.id })
      .eq('id', fundId)
      .eq('household_id', householdId);
    if (linkError) {
      console.error('Sinking fund link error:', linkError);
      return NextResponse.json({ error: linkError.message || 'Fund account created but linking failed' }, { status: 500 });
    }

    const provision = fund.monthly_provision != null ? Number(fund.monthly_provision) : 0;
    if (!(provision > 0)) {
      // No recurring contribution to set up (a fund with no stated monthly
      // provision) — the account exists and is linked; contributions can
      // still be made manually from Goals/Timeline like any goal account.
      return NextResponse.json({ created: true, accountId: account.id, recurringItemId: null, materialized: 0 });
    }

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const today = businessToday(timezone);
    const monthStart = `${today.slice(0, 7)}-01`;

    const { data: item, error: itemError } = await supabase
      .from('recurring_items')
      .insert({
        household_id: householdId,
        member_id: member.id,
        category_id: null,
        account_id: chequing.id,
        destination_account_id: account.id,
        description: fund.name,
        amount: provision,
        type: 'transfer',
        cadence: 'monthly',
        anchor_date: today,
        second_day: null,
      })
      .select('id')
      .single();
    if (itemError || !item) {
      console.error('Sinking fund recurring rule create error:', itemError);
      return NextResponse.json(
        { error: itemError?.message || 'Fund account created but recurring contribution failed', created: true, accountId: account.id },
        { status: 500 }
      );
    }

    const dates = materializeFromMonthStart({ cadence: 'monthly', anchorDate: today, secondDay: null }, today, 12);
    const { materialized, error: materializeErr } = await materializeTransferOccurrences(supabase, {
      householdId,
      memberId: member.id,
      chequingId: chequing.id,
      destinationId: account.id,
      amount: provision,
      description: fund.name,
      recurringItemId: item.id,
      dates,
    });
    if (materializeErr) {
      console.error('Sinking fund materialization error:', materializeErr);
      return NextResponse.json(
        { error: materializeErr, created: true, accountId: account.id, recurringItemId: item.id, materialized },
        { status: 500 }
      );
    }

    return NextResponse.json({ created: true, accountId: account.id, recurringItemId: item.id, materialized });
  } catch (error) {
    console.error('Start-funding POST error:', error);
    return NextResponse.json({ error: 'Failed to start funding this sinking fund' }, { status: 500 });
  }
}
