import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { businessToday, materializeFromMonthStart } from '@/lib/dateHelpers';
import { GOAL_ACCOUNT_TYPES } from '@/lib/dashboardHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';
import { materializeTransferOccurrences } from '@/lib/recurringTransferHelpers';

type Cadence = 'monthly' | 'biweekly' | 'semimonthly' | 'weekly';

async function getContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  if (!userRow?.household_id) return null;
  const { data: member } = await supabase
    .from('household_members').select('id')
    .eq('household_id', userRow.household_id).eq('user_id', user.id).single();
  return { userId: user.id, householdId: userRow.household_id, memberId: member?.id ?? null };
}

// GET: list recurring items for the household
export async function GET() {
  try {
    const supabase = await createClient();
    const ctx = await getContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // active=false rules are ones an effective-dated edit has superseded
    // (Timeline Part B, split-into-two-rules) — they're frozen history, not
    // something to act on, so the list only ever shows the live row. This is
    // what keeps a split invisible in the UI: the old row disappears and the
    // new one appears in its place at the same list position, reading as a
    // normal in-place edit even though two rule rows now exist underneath.
    const { data: items } = await supabase
      .from('recurring_items')
      .select(
        'id, description, amount, type, cadence, anchor_date, second_day, active, category_id, account_id, destination_account_id, member_id, ' +
        'categories(name), accounts!recurring_items_account_id_fkey(name, type), ' +
        'destination_accounts:accounts!recurring_items_destination_account_id_fkey(name), household_members(name)'
      )
      .eq('household_id', ctx.householdId)
      .eq('active', true)
      .order('type', { ascending: true })
      .order('description', { ascending: true });

    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, name, type')
      .eq('household_id', ctx.householdId)
      .order('type', { ascending: true });

    // Goal accounts (savings/tfsa/rrsp) cannot be the target of a recurring
    // expense or income — they only receive money via transfers.
    const spendingAccounts = (accounts ?? []).filter(
      (a) => !(GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type)
    );
    // ...and conversely, goal accounts are the only valid destination for a
    // recurring transfer — surfaced separately for that selector.
    const goalAccounts = (accounts ?? []).filter(
      (a) => (GOAL_ACCOUNT_TYPES as readonly string[]).includes(a.type)
    );

    const { data: categories } = await supabase
      .from('categories')
      .select('id, name')
      .eq('household_id', ctx.householdId)
      .eq('type', 'expense')
      .order('name');

    return NextResponse.json({
      items: items ?? [],
      accounts: spendingAccounts,
      goalAccounts,
      categories: categories ?? [],
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load recurring items' }, { status: 500 });
  }
}

// POST: create a recurring item + materialize 12 months of transactions.
//
// type='transfer' is a recurring chequing→goal transfer (Build 4 Phase 2):
// destinationAccountId (a goal account) replaces categoryId, the source
// account is always resolved to the household's chequing account (never
// user-selected — same as one-off transfers via /api/transfers), and
// materialization calls the SAME create_transfer RPC one-off transfers use,
// once per occurrence date, tagging recurring_item_id on both sides of each
// pair so a later edit/delete can find and remove them together.
export async function POST(request: Request) {
  try {
    const { description, amount, type, cadence, anchorDate, secondDay, categoryId, accountId, destinationAccountId } =
      await request.json();

    if (!description?.trim() || !amount || !type || !cadence) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!['income', 'expense', 'transfer'].includes(type)) {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
    }

    const validCadences: Cadence[] = type === 'transfer'
      ? ['monthly', 'biweekly', 'semimonthly', 'weekly']
      : ['monthly', 'biweekly', 'semimonthly'];
    if (!validCadences.includes(cadence)) {
      return NextResponse.json({ error: 'Invalid cadence' }, { status: 400 });
    }

    if (type === 'expense' && !categoryId) {
      return NextResponse.json({ error: 'Category required for expense recurring items' }, { status: 400 });
    }
    if (type !== 'transfer' && !anchorDate) {
      return NextResponse.json({ error: 'Anchor date required' }, { status: 400 });
    }
    if (type !== 'transfer' && !accountId) {
      return NextResponse.json({ error: 'Account required' }, { status: 400 });
    }
    if (type === 'transfer' && !destinationAccountId) {
      return NextResponse.json({ error: 'Destination goal account required for a recurring transfer' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await getContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (!ctx.memberId) return NextResponse.json({ error: 'No member record' }, { status: 400 });

    let resolvedAccountId: string;
    let resolvedCategoryId: string | null = categoryId || null;
    let resolvedDestinationId: string | null = null;

    if (type === 'transfer') {
      const { data: chequing } = await supabase
        .from('accounts')
        .select('id')
        .eq('household_id', ctx.householdId)
        .eq('type', 'chequing')
        .single();
      if (!chequing) return NextResponse.json({ error: 'No chequing account found' }, { status: 400 });
      resolvedAccountId = chequing.id;
      resolvedCategoryId = null;

      const { data: goalAccount } = await supabase
        .from('accounts')
        .select('id, type')
        .eq('id', destinationAccountId)
        .eq('household_id', ctx.householdId)
        .single();
      if (!goalAccount || !(GOAL_ACCOUNT_TYPES as readonly string[]).includes(goalAccount.type)) {
        return NextResponse.json({ error: 'Invalid destination goal account' }, { status: 400 });
      }
      resolvedDestinationId = goalAccount.id;
    } else {
      const { data: account } = await supabase
        .from('accounts')
        .select('id')
        .eq('id', accountId)
        .eq('household_id', ctx.householdId)
        .single();
      if (!account) {
        return NextResponse.json({ error: 'Invalid account' }, { status: 400 });
      }
      resolvedAccountId = account.id;
    }

    // 1. Create the rule
    // Expenses are household-level, not personal — same rule save-plan's
    // onboarding path already follows for fixed expenses (member_id null,
    // see importProvenance-adjacent logic in save-plan/route.ts). Income
    // (and a transfer's initiating member) keep the creator's own member_id,
    // unchanged from before.
    const { data: item, error: itemError } = await supabase
      .from('recurring_items')
      .insert({
        household_id: ctx.householdId,
        member_id: type === 'expense' ? null : ctx.memberId,
        category_id: resolvedCategoryId,
        account_id: resolvedAccountId,
        destination_account_id: resolvedDestinationId,
        description: description.trim(),
        amount,
        type,
        cadence,
        anchor_date: anchorDate || null,
        second_day: secondDay ?? null,
      })
      .select('id')
      .single();

    if (itemError || !item) {
      console.error('Recurring insert error:', itemError);
      return NextResponse.json({ error: 'Failed to create recurring item' }, { status: 500 });
    }

    // 2. Materialize 12 months forward from the start of the current month —
    // not from today. A new rule whose anchor lands earlier this month (e.g.
    // added mid-month for a bill already paid on the 1st) still needs that
    // occurrence recorded; months are real, not just their remainder. No
    // anchor yet (needs-a-date) means no dated instances, not a fabricated
    // guess.
    const timezone = await getHouseholdTimezone(supabase, ctx.householdId);
    const today = businessToday(timezone);
    const monthStart = `${today.slice(0, 7)}-01`;
    const dates = anchorDate
      ? materializeFromMonthStart({ cadence, anchorDate, secondDay: secondDay ?? null }, today, 12)
      : [];

    if (type === 'transfer') {
      // Paired materialization: one create_transfer RPC call per occurrence
      // date, exactly the atomic mechanism one-off transfers use. Each call
      // is independently atomic (both sides or neither); a mid-loop failure
      // stops materialization but never leaves a half-written pair.
      const { materialized, error: materializeErr } = await materializeTransferOccurrences(supabase, {
        householdId: ctx.householdId,
        memberId: ctx.memberId,
        chequingId: resolvedAccountId,
        destinationId: resolvedDestinationId!,
        amount,
        description: description.trim(),
        recurringItemId: item.id,
        dates,
      });
      if (materializeErr) {
        console.error('Recurring transfer materialization RPC error:', materializeErr);
        return NextResponse.json(
          { error: `Item created but ${materializeErr}`, created: true, id: item.id, materialized },
          { status: 500 }
        );
      }
      return NextResponse.json({ created: true, id: item.id, materialized });
    }

    // 3. Idempotently write this-month-onward transaction rows, linked back to the rule
    const { error: deleteError } = await supabase
      .from('transactions')
      .delete()
      .eq('household_id', ctx.householdId)
      .eq('recurring_item_id', item.id)
      .gte('date', monthStart);

    if (deleteError) {
      console.error('Materialize cleanup error:', deleteError);
      return NextResponse.json({ error: 'Item created but materialization cleanup failed' }, { status: 500 });
    }

    if (dates.length) {
      const rows = dates.map((d) => ({
        household_id: ctx.householdId,
        member_id: ctx.memberId,
        category_id: resolvedCategoryId,
        account_id: resolvedAccountId,
        amount,
        description: description.trim(),
        date: d,
        type,
        source: 'manual',
        recurring_item_id: item.id,
      }));
      const { error: txError } = await supabase.from('transactions').insert(rows);
      if (txError) {
        console.error('Materialize insert error:', txError);
        return NextResponse.json({ error: 'Item created but materialization failed' }, { status: 500 });
      }
    }

    return NextResponse.json({ created: true, id: item.id, materialized: dates.length });
  } catch (error) {
    console.error('Recurring POST error:', error);
    return NextResponse.json({ error: 'Failed to create recurring item' }, { status: 500 });
  }
}
