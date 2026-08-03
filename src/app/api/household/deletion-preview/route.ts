import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { loadDeletionContext } from '@/lib/deletionContext';

// ---------------------------------------------------------------------------
// GET /api/household/deletion-preview
//
// Everything the settings screen needs to render an honest deletion section:
// which deletion (if any) is available to this caller, what it would destroy,
// and what they must type to confirm it.
//
// Available to owners AND members — a member has to be able to see that leaving
// is possible, and what it would and would not take with them. It is read-only;
// the destructive routes re-check the verdict themselves.
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id, role, email')
      .eq('id', user.id)
      .single();

    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household for this account' }, { status: 400 });
    }

    const admin = createAdminClient();
    const ctx = await loadDeletionContext(admin, user.id, userRow.household_id);
    if (!ctx) {
      return NextResponse.json({ error: 'No member record for this account' }, { status: 404 });
    }

    const isHouseholdDelete = ctx.verdict.mode === 'household_delete';

    return NextResponse.json({
      verdict: ctx.verdict,
      role: userRow.role,
      householdName: ctx.householdName,
      blastRadius: ctx.blastRadius,

      // What the person must type. The phrase differs by action on purpose:
      // destroying a household asks for the household's name, leaving one asks
      // for your own email. Neither is a generic word that reads the same on
      // every screen in the product.
      confirmWith: isHouseholdDelete
        ? { field: 'confirmHouseholdName', phrase: ctx.householdName }
        : { field: 'confirmEmail', phrase: userRow.email ?? user.email ?? null },

      // Stated by the API, not just drawn by the UI, so no caller can present
      // this as reversible.
      reversible: false,
      gracePeriodDays: 0,
    });
  } catch (err) {
    console.error('Deletion preview threw:', err);
    return NextResponse.json({ error: 'Failed to load deletion preview' }, { status: 500 });
  }
}
