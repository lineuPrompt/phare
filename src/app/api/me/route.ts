import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { logEvent } from '@/lib/eventLogger';
import { loadDeletionContext } from '@/lib/deletionContext';
import { confirmationMatches } from '@/lib/accountDeletionHelpers';

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id, role, full_name')
      .eq('id', user.id)
      .single();

    if (!userRow) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    return NextResponse.json({
      id: user.id,
      email: user.email,
      role: userRow.role,
      household_id: userRow.household_id,
      full_name: userRow.full_name,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load user' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/me — member self-deletion (Case B).
//
// Body: { confirmEmail: string }
//
// SCOPE. This is Case B only: one member leaves, the household SURVIVES.
// Whole-household deletion (Case A) is DELETE /api/household. This route
// refuses anything that would amount to Case A and says which door to use,
// rather than quietly doing something bigger than what was asked for.
//
// The verdict is computed by decideDeletion() and re-checked here, and the two
// boundary conditions are ALSO refused by delete_household_member() itself
// (PH409 last member, PH412 sole owner) so they hold even if some future
// caller skips this route's checks.
//
// SELF ONLY. There is no member id in the path or body: the subject is always
// the authenticated caller. An owner removing somebody else is a different
// act with different consent, and this route deliberately cannot express it.
//
// ORDER OF OPERATIONS — the whole design is in this sequence:
//   1. Write the record of intent. BEFORE either mutation, so a crash between
//      them leaves something discoverable rather than a silently half-deleted
//      person. If this insert fails we abort having changed nothing.
//   2. DB half, one plpgsql transaction (delete_household_member): tombstone
//      the member row, purge type='chat', revoke access by NULLing
//      users.household_id, stamp db_completed_at.
//   3. Global sign-out — best effort, never fatal.
//   4. Auth half: hard-delete auth.users. RETRYABLE. If it fails, step 2 has
//      already revoked all access, so the failure is an erasure that is late,
//      not a security hole. We record last_error and return 202.
//
// WHY TYPE YOUR OWN EMAIL. An irreversible erasure must not be one stray
// fetch away, and the phrase must be specific to what is being destroyed — a
// generic word reads identically on every screen in the product and can be
// typed without reading. Your own address is the thing you are giving up.
// ---------------------------------------------------------------------------
export async function DELETE(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { confirmEmail } = (body ?? {}) as { confirmEmail?: unknown };

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id, email')
      .eq('id', user.id)
      .single();

    if (!userRow?.household_id) {
      // Also the state a partially-deleted account is left in, which is why
      // this reads as "nothing to do" rather than as an error.
      return NextResponse.json({ error: 'No household for this account' }, { status: 400 });
    }

    const admin = createAdminClient();

    const ctx = await loadDeletionContext(admin, user.id, userRow.household_id);
    if (!ctx || !ctx.selfMemberId) {
      return NextResponse.json({ error: 'No member record for this account' }, { status: 404 });
    }

    // ---- Which deletion is this, really? -----------------------------------
    // Refusing here is the point: every branch that is not self_delete would,
    // if carried out, destroy more than the caller asked to destroy.
    if (ctx.verdict.mode === 'household_delete') {
      return NextResponse.json(
        {
          error: ctx.verdict.reason === 'sole_member'
            ? 'You are the only person with an account here, so deleting it deletes the whole household and everything in it.'
            : 'Nobody else has ever signed in to this household, so there is no one to hand it to — deleting your account means deleting the household.',
          code: 'household_deletion_required',
          reason: ctx.verdict.reason,
        },
        { status: 409 }
      );
    }
    if (ctx.verdict.mode === 'blocked_promote') {
      return NextResponse.json(
        {
          error: 'You are the only owner. Make another member an owner from the Household page, then delete your account.',
          code: 'promote_first',
          candidates: ctx.verdict.candidates,
        },
        { status: 409 }
      );
    }
    if (ctx.verdict.mode === 'blocked_no_path') {
      return NextResponse.json(
        {
          error: 'Another member still has access, but their role could not be read, so ownership cannot be handed over safely yet.',
          code: 'blocked_no_path',
        },
        { status: 409 }
      );
    }

    // Confirmation phrase: the caller's own email address.
    const expectedEmail = userRow.email ?? user.email ?? null;
    if (!confirmationMatches(expectedEmail, confirmEmail)) {
      return NextResponse.json(
        { error: 'Type your email address exactly to confirm.', code: 'confirmation_mismatch' },
        { status: 400 }
      );
    }

    // ---- 1. Record of intent, before either mutation -----------------------
    const { data: reqRow, error: reqErr } = await admin
      .from('member_deletion_requests')
      .insert({
        household_id: userRow.household_id,
        kind: 'member',
        member_id: ctx.selfMemberId,
        subject_user_id: user.id,
        subject_email: userRow.email ?? user.email ?? null,
      })
      .select('id')
      .single();

    if (reqErr || !reqRow) {
      console.error('Self-deletion — could not write intent record, aborting before any mutation:', reqErr);
      return NextResponse.json(
        { error: 'Could not start account deletion. Nothing has been changed.' },
        { status: 500 }
      );
    }

    // ---- 2. DB half, one transaction ---------------------------------------
    // Service-role client on purpose: this NULLs users.household_id, and every
    // RLS policy in the schema resolves the tenant through that column — under
    // the caller's own client the later statements would match zero rows. See
    // the function's own header.
    const { data: dbResult, error: rpcErr } = await admin.rpc('delete_household_member', {
      p_household_id: userRow.household_id,
      p_member_id: ctx.selfMemberId,
      p_user_id: user.id,
      p_request_id: reqRow.id,
    });

    if (rpcErr) {
      // The guards raise with distinct SQLSTATEs so a refusal reads as a
      // refusal, not as a server fault.
      const code = (rpcErr as { code?: string }).code;
      if (code === 'PH409') {
        return NextResponse.json(
          {
            error: 'You are the last member with access to this household. Deleting your account here would leave the household unreachable — that is whole-household deletion, which is a separate action.',
            code: 'last_member',
          },
          { status: 409 }
        );
      }
      if (code === 'PH412') {
        return NextResponse.json(
          {
            error: 'You are the only owner of this household. Make another member an owner before deleting your account.',
            code: 'sole_owner',
          },
          { status: 409 }
        );
      }
      console.error('Self-deletion — delete_household_member RPC failed (requestId for ops):', reqRow.id, rpcErr);
      await admin
        .from('member_deletion_requests')
        .update({ last_error: `db: ${rpcErr.message ?? String(rpcErr)}` })
        .eq('id', reqRow.id);
      return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
    }

    // Logged with the admin client, not the caller's: step 2 just NULLed
    // users.household_id, and the events RLS policy resolves the household
    // through exactly that column, so the caller's own client can no longer
    // insert here.
    await logEvent(admin, userRow.household_id, user.id, 'member_self_deleted', {
      member_id: ctx.selfMemberId,
      request_id: reqRow.id,
    });

    // ---- 3. Global sign-out — defence in depth, never fatal ----------------
    // Access is already dead as of step 2 (no household_id → getCallerInfo
    // returns null → 401, and RLS matches nothing). This kills refresh tokens
    // so the session cannot be quietly extended; it cannot retract an access
    // token already issued, which is precisely why step 2 does the real work.
    //
    // NOTE the argument: admin.signOut takes a JWT, NOT a user id
    // (`signOut(jwt: string, scope?: SignOutScope)`). Passing the user id here
    // is a silent no-op that still resolves, so the session token is read from
    // the caller's own session — which this route always has, because the
    // subject is always the caller.
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await admin.auth.admin.signOut(session.access_token, 'global');
      } else {
        console.error('Self-deletion — no access token available for global sign-out (non-fatal, requestId for ops):', reqRow.id);
      }
    } catch (signOutErr) {
      console.error('Self-deletion — global sign-out failed (non-fatal, requestId for ops):', reqRow.id, signOutErr);
    }

    // ---- 4. Auth half — retryable ------------------------------------------
    // deleteUser(id) hard-deletes by default (shouldSoftDelete defaults false),
    // which is what erasure requires — a soft delete would keep the identity row.
    const { error: authErr } = await admin.auth.admin.deleteUser(user.id);

    if (authErr) {
      console.error('Self-deletion — auth deleteUser failed; DB half stands, retry needed (requestId for ops):', reqRow.id, authErr);
      await admin
        .from('member_deletion_requests')
        .update({ last_error: `auth: ${authErr.message}` })
        .eq('id', reqRow.id);

      // 202, not 500: the household-side work committed and all access is
      // revoked. What is outstanding is the identity erasure, and the marker
      // row makes it discoverable and retryable.
      return NextResponse.json(
        {
          status: 'partial',
          message: 'Your access has been removed and your household data is no longer linked to you. Final removal of your login is still in progress.',
          requestId: reqRow.id,
        },
        { status: 202 }
      );
    }

    await admin
      .from('member_deletion_requests')
      .update({ auth_completed_at: new Date().toISOString(), last_error: null })
      .eq('id', reqRow.id);

    return NextResponse.json({
      status: 'deleted',
      requestId: reqRow.id,
      ...(dbResult as Record<string, unknown> ?? {}),
    });
  } catch (err) {
    console.error('Self-deletion DELETE threw:', err);
    return NextResponse.json({ error: 'Failed to delete account' }, { status: 500 });
  }
}
