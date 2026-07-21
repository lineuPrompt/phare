import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { businessToday } from '@/lib/dateHelpers';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

async function resolveContext(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: userRow } = await supabase
    .from('users').select('household_id').eq('id', user.id).single();
  if (!userRow?.household_id) return null;
  return { user, householdId: userRow.household_id as string };
}

// GET /api/anchors?account=<id>
// Returns all anchors for a chequing account, sorted ascending by date.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const accountId = url.searchParams.get('account');
    if (!accountId) {
      return NextResponse.json({ error: 'Missing account param' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await resolveContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // Verify account belongs to household and is chequing
    const { data: account } = await supabase
      .from('accounts')
      .select('id, type')
      .eq('id', accountId)
      .eq('household_id', ctx.householdId)
      .single();
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (account.type !== 'chequing') {
      return NextResponse.json({ error: 'Only chequing accounts support anchors' }, { status: 400 });
    }

    const { data: anchors } = await supabase
      .from('account_balance_anchors')
      .select('id, anchor_date, balance, created_at')
      .eq('account_id', accountId)
      .eq('household_id', ctx.householdId)
      .order('anchor_date', { ascending: true });

    return NextResponse.json({ anchors: anchors ?? [] });
  } catch {
    return NextResponse.json({ error: 'Failed to load anchors' }, { status: 500 });
  }
}

// POST /api/anchors
// Upserts an anchor for a chequing account on a given date.
// Body: { accountId, anchorDate, balance }
//   accountId  — chequing account UUID
//   anchorDate — YYYY-MM-DD, must not be in the future
//   balance    — finite number (negative allowed)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { accountId, anchorDate, balance } = body ?? {};

    if (!accountId || !anchorDate || balance === undefined || balance === null) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
      return NextResponse.json({ error: 'Invalid anchorDate format (expected YYYY-MM-DD)' }, { status: 400 });
    }
    const numBalance = Number(balance);
    if (!isFinite(numBalance)) {
      return NextResponse.json({ error: 'balance must be a finite number' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await resolveContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // businessToday (not `.toISOString()`, which is always UTC, and not the
    // server process's local clock, which is also UTC in production) is the
    // canonical "today" reference across Phare — resolved in the household's
    // own timezone. For a household behind UTC (e.g. Montréal, UTC-4/-5),
    // anything else rolls over to the next calendar day several hours before
    // local midnight, so in the evening this check would have wrongly
    // ALLOWED an anchor dated the user's actual local tomorrow.
    const timezone = await getHouseholdTimezone(supabase, ctx.householdId);
    const today = businessToday(timezone);
    if (anchorDate > today) {
      return NextResponse.json({ error: 'anchorDate must not be in the future' }, { status: 400 });
    }

    const { data: account } = await supabase
      .from('accounts')
      .select('id, type')
      .eq('id', accountId)
      .eq('household_id', ctx.householdId)
      .single();
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });
    if (account.type !== 'chequing') {
      return NextResponse.json({ error: 'Only chequing accounts support anchors' }, { status: 400 });
    }

    const { data: upserted, error: upsertError } = await supabase
      .from('account_balance_anchors')
      .upsert(
        {
          household_id: ctx.householdId,
          account_id: accountId,
          anchor_date: anchorDate,
          balance: Math.round(numBalance * 100) / 100,
        },
        { onConflict: 'account_id,anchor_date' }
      )
      .select('id, anchor_date, balance, created_at')
      .single();

    if (upsertError) {
      console.error('Anchor upsert error:', upsertError);
      return NextResponse.json({ error: 'Failed to save anchor' }, { status: 500 });
    }

    return NextResponse.json({ anchor: upserted });
  } catch {
    return NextResponse.json({ error: 'Failed to save anchor' }, { status: 500 });
  }
}

// DELETE /api/anchors?id=<anchor-uuid>
export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const anchorId = url.searchParams.get('id');
    if (!anchorId) {
      return NextResponse.json({ error: 'Missing id param' }, { status: 400 });
    }

    const supabase = await createClient();
    const ctx = await resolveContext(supabase);
    if (!ctx) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    // .select() after .delete() returns the rows actually deleted — a
    // DELETE matching zero rows (already deleted, wrong id, or someone
    // else's household) is NOT a Postgres/PostgREST error, so without this
    // the old code returned {deleted: true} unconditionally, including when
    // nothing was touched (a lost race between two tabs deleting the same
    // anchor, or a stale client retrying an already-completed delete).
    const { data: deletedRows, error: deleteError } = await supabase
      .from('account_balance_anchors')
      .delete()
      .eq('id', anchorId)
      .eq('household_id', ctx.householdId)
      .select('id');

    if (deleteError) {
      console.error('Anchor delete error:', deleteError);
      return NextResponse.json({ error: 'Failed to delete anchor' }, { status: 500 });
    }

    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json({ error: 'Anchor not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch {
    return NextResponse.json({ error: 'Failed to delete anchor' }, { status: 500 });
  }
}
