import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { businessToday, materializeFromMonthStart } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import { materializeTransferOccurrences } from '@/lib/recurringTransferHelpers';

/**
 * POST /api/sinking-funds/start-funding
 *
 * Turns EVERY dead sinking-fund provision into ONE real cash buffer (Build 4
 * Part A, 2026-07-21 revision). No family runs seven separate sinking
 * accounts — this sums every provision's monthly_provision into a single
 * recurring contribution, into a single 'savings' account flagged
 * is_sinking_fund, and links every sinking_funds row to that SAME account
 * (linked_account_id is shared across rows on purpose — the per-fund rows
 * stay informational display only: "$258/mo of the $708 total", never a
 * second account or a second contribution). "Pay this bill" (existing
 * per-fund flow, unchanged) still draws from whichever fund's row the family
 * clicks, using this one shared account as the source.
 *
 * Reuses the exact same account-creation and create_transfer materialization
 * machinery the (now-removed) per-fund version used — only the amount fed
 * into it changes, from one fund's own provision to the summed total.
 */
export async function POST() {
  try {
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

    const { data: funds } = await supabase
      .from('sinking_funds')
      .select('id, monthly_provision, linked_account_id')
      .eq('household_id', householdId);
    if (!funds || funds.length === 0) {
      return NextResponse.json({ error: 'No sinking funds to fund' }, { status: 400 });
    }
    if (funds.some((f) => f.linked_account_id)) {
      return NextResponse.json({ error: 'Your sinking fund is already being funded' }, { status: 400 });
    }

    const totalMonthlyProvision = funds.reduce(
      (sum, f) => sum + (f.monthly_provision != null ? Number(f.monthly_provision) : 0), 0
    );
    if (!(totalMonthlyProvision > 0)) {
      return NextResponse.json({ error: 'No provision amount to fund' }, { status: 400 });
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
        name: 'Sinking funds',
        type: 'savings',
        is_sinking_fund: true,
        sort_order: nextSortOrder,
      })
      .select('id')
      .single();
    if (acctError || !account) {
      console.error('Sinking fund account create error:', acctError);
      return NextResponse.json({ error: acctError?.message || 'Failed to create fund account' }, { status: 500 });
    }

    // Every sinking_funds row shares this one account — the whole point of
    // the collapse (one balance, not one per fund).
    const { error: linkError } = await supabase
      .from('sinking_funds')
      .update({ linked_account_id: account.id })
      .eq('household_id', householdId);
    if (linkError) {
      console.error('Sinking fund link error:', linkError);
      return NextResponse.json({ error: linkError.message || 'Fund account created but linking failed' }, { status: 500 });
    }

    const timezone = await getHouseholdTimezone(supabase, householdId);
    const today = businessToday(timezone);

    const { data: item, error: itemError } = await supabase
      .from('recurring_items')
      .insert({
        household_id: householdId,
        member_id: member.id,
        category_id: null,
        account_id: chequing.id,
        destination_account_id: account.id,
        description: 'Sinking funds',
        amount: totalMonthlyProvision,
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
      amount: totalMonthlyProvision,
      description: 'Sinking funds',
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

    return NextResponse.json({ created: true, accountId: account.id, recurringItemId: item.id, materialized, totalMonthlyProvision });
  } catch (error) {
    console.error('Start-funding POST error:', error);
    return NextResponse.json({ error: 'Failed to start funding your sinking fund' }, { status: 500 });
  }
}
