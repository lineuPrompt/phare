import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { loadDeletionContext } from '@/lib/deletionContext';
import { confirmationMatches } from '@/lib/accountDeletionHelpers';

// ---------------------------------------------------------------------------
// DELETE /api/household — Case A, whole-household deletion.
//
// Body: { confirmHouseholdName: string }
//
// WHO MAY CALL THIS. Only an owner, and only when nobody else can still sign
// in — decideDeletion() must return household_delete, for one of two reasons:
//   sole_member — no other account exists; their account IS the household.
//   all_pending — others exist but not one has ever signed in, so there is
//                 nobody to promote. This is the escape hatch, and it is the
//                 only path that destroys a household that still has other
//                 member rows in it.
// A household with any other ACTIVE member is not the caller's to destroy; the
// preview returns blocked_promote and the answer is to promote that person.
//
// ORDER OF OPERATIONS — inverted relative to Case B, deliberately:
//   1. Record of intent (kind='household').
//   2. Erase every member's auth identity, retryable, CALLER LAST.
//   3. Drop the household row; the cascade takes everything, including the
//      marker row from step 1.
//
// Case B is DB-first because its DB step is what revokes access and the
// household survives to hold the marker. Here the DB step DESTROYS the marker
// (member_deletion_requests.household_id cascades from households), so it has
// to run last or a Case A that died halfway would leave nothing to find. The
// marker row's continued existence IS the "unfinished" signal; its
// disappearance is the success signal.
//
// The caller's own auth row goes last so that, if the loop dies partway, the
// person who started this can still sign in and retry rather than being locked
// out of a half-deleted household.
// ---------------------------------------------------------------------------
export async function DELETE(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { confirmHouseholdName } = (body ?? {}) as { confirmHouseholdName?: unknown };

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
    if (userRow.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the household owner can delete the household' },
        { status: 403 }
      );
    }

    const admin = createAdminClient();
    const ctx = await loadDeletionContext(admin, user.id, userRow.household_id);
    if (!ctx) {
      return NextResponse.json({ error: 'No member record for this account' }, { status: 404 });
    }

    // Re-checked here, not trusted from the client. The preview is a hint for
    // rendering; this is the enforcement.
    if (ctx.verdict.mode !== 'household_delete') {
      if (ctx.verdict.mode === 'blocked_promote') {
        return NextResponse.json(
          {
            error: 'Another member still uses this household. Make one of them an owner from the Household page, then delete your own account instead.',
            code: 'promote_first',
            candidates: ctx.verdict.candidates,
          },
          { status: 409 }
        );
      }
      if (ctx.verdict.mode === 'blocked_no_path') {
        return NextResponse.json(
          {
            error: 'Another member still has access to this household, but their role could not be read. Deleting everything is not safe until that is resolved.',
            code: 'blocked_no_path',
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: 'Another owner is active in this household — delete your own account instead of the whole household.',
          code: 'self_delete_instead',
        },
        { status: 409 }
      );
    }

    // Confirmation phrase: the household's own name.
    if (!confirmationMatches(ctx.householdName, confirmHouseholdName)) {
      return NextResponse.json(
        {
          error: 'Type your household’s name exactly to confirm.',
          code: 'confirmation_mismatch',
        },
        { status: 400 }
      );
    }

    // ---- 1. Record of intent -----------------------------------------------
    const { data: reqRow, error: reqErr } = await admin
      .from('member_deletion_requests')
      .insert({
        household_id: userRow.household_id,
        kind: 'household',
        member_id: null,
        subject_user_id: user.id,
        subject_email: userRow.email ?? user.email ?? null,
      })
      .select('id')
      .single();

    if (reqErr || !reqRow) {
      console.error('Household deletion — could not write intent record, aborting before any mutation:', reqErr);
      return NextResponse.json(
        { error: 'Could not start deletion. Nothing has been changed.' },
        { status: 500 }
      );
    }

    // ---- 2. Erase every identity, caller last ------------------------------
    const { data: householdUsers } = await admin
      .from('users')
      .select('id')
      .eq('household_id', userRow.household_id);

    const ids = ((householdUsers ?? []) as { id: string }[]).map((u) => u.id);
    const ordered = [...ids.filter((id) => id !== user.id), ...ids.filter((id) => id === user.id)];

    const failed: string[] = [];
    for (const id of ordered) {
      const { error: delErr } = await admin.auth.admin.deleteUser(id);
      if (delErr) {
        // Logged without the email — the marker row already holds who
        // authorized this, under household-scoped RLS.
        console.error('Household deletion — deleteUser failed (requestId for ops):', reqRow.id, id, delErr);
        failed.push(id);
      }
    }

    if (failed.length > 0) {
      await admin
        .from('member_deletion_requests')
        .update({ last_error: `auth: ${failed.length} identity deletion(s) failed` })
        .eq('id', reqRow.id);

      // Stop before dropping the household. delete_household() would refuse
      // anyway (PH425), but failing here keeps the household intact and
      // reachable so the retry is a retry, not a recovery.
      return NextResponse.json(
        {
          status: 'partial',
          message: 'Some accounts could not be removed, so the household has not been deleted. Nothing is lost — please try again.',
          requestId: reqRow.id,
        },
        { status: 202 }
      );
    }

    await admin
      .from('member_deletion_requests')
      .update({ auth_completed_at: new Date().toISOString(), last_error: null })
      .eq('id', reqRow.id);

    // ---- 3. Drop the household — cascade takes everything -------------------
    const { data: result, error: rpcErr } = await admin.rpc('delete_household', {
      p_household_id: userRow.household_id,
      p_request_id: reqRow.id,
    });

    if (rpcErr) {
      console.error('Household deletion — delete_household RPC failed (requestId for ops):', reqRow.id, rpcErr);
      await admin
        .from('member_deletion_requests')
        .update({ last_error: `db: ${rpcErr.message ?? String(rpcErr)}` })
        .eq('id', reqRow.id);
      return NextResponse.json(
        {
          status: 'partial',
          message: 'Your accounts were removed but the household data could not be deleted. This has been recorded and will be completed.',
          requestId: reqRow.id,
        },
        { status: 202 }
      );
    }

    // No marker row remains to stamp — it cascaded with the household. That
    // absence is the success signal; see the ops query in the migration.
    return NextResponse.json({
      status: 'deleted',
      ...(result as Record<string, unknown> ?? {}),
    });
  } catch (err) {
    console.error('Household DELETE threw:', err);
    return NextResponse.json({ error: 'Failed to delete household' }, { status: 500 });
  }
}
