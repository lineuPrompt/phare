import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { loadDeletionContext } from '@/lib/deletionContext';
import { confirmationMatches } from '@/lib/accountDeletionHelpers';
import { stripeConfigured, cancelSubscription } from '@/lib/stripe';

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
//   2. Cancel the Stripe subscription, if any. FAIL-CLOSED: if there is one and
//      it cannot be cancelled, nothing else happens.
//   3. Erase every member's auth identity, retryable, CALLER LAST.
//   4. Drop the household row; the cascade takes everything, including the
//      marker row from step 1.
//
// The sequence runs MOST-REVERSIBLE FIRST. A cancelled subscription can be
// resumed. A deleted auth user cannot. A cascaded household certainly cannot.
// So the money step goes first: it is both the easiest to undo and the only one
// whose omission keeps charging a real person after everything else is gone.
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

    // The subscription id is read HERE, while the household still exists. The
    // cascade in step 4 destroys it permanently, so this is the last moment
    // anything can learn which subscription belongs to this household.
    const { data: household, error: householdErr } = await admin
      .from('households')
      .select('stripe_subscription_id')
      .eq('id', userRow.household_id)
      .single();

    if (householdErr || !household) {
      console.error('Household deletion — could not read billing state, aborting before any mutation:', householdErr);
      return NextResponse.json(
        { error: 'Could not start deletion. Nothing has been changed.' },
        { status: 500 }
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

    // ---- 2. Cancel the Stripe subscription — FIRST, and for a reason -------
    //
    // This runs before a single identity is touched because it is the most
    // REVERSIBLE step in the sequence. A cancelled subscription can be
    // resumed; a deleted auth user cannot be un-deleted, and a cascaded
    // household cannot be un-cascaded. Ordering the recoverable action first
    // means a failure here leaves the household completely intact.
    //
    // It must also happen before the cascade for a harder reason: the cascade
    // destroys households.stripe_subscription_id. Afterwards there is no way to
    // find the subscription, and Stripe keeps billing a real person every month
    // for a household that no longer exists — with nothing in our database
    // left to notice it.
    //
    // THE FAIL-CLOSED BRANCH. If this household HAS a subscription and we
    // cannot cancel it — Stripe unreachable, key missing, API error — we abort
    // the whole deletion. Proceeding would trade "the user has to try again"
    // for "we bill someone forever for something that does not exist", and only
    // one of those is recoverable.
    let stripeCancelledAt: string | null = null;

    if (household.stripe_subscription_id) {
      if (!stripeConfigured()) {
        console.error(
          'Household deletion — household has a subscription but STRIPE_SECRET_KEY is unset; refusing to delete (requestId for ops):',
          reqRow.id
        );
        await admin
          .from('member_deletion_requests')
          .update({ last_error: 'stripe: not configured — refused to delete a household with a live subscription' })
          .eq('id', reqRow.id);
        return NextResponse.json(
          {
            error: 'Your subscription could not be cancelled, so nothing has been deleted. Please contact support@phare.money.',
            code: 'stripe_unavailable',
            requestId: reqRow.id,
          },
          { status: 503 }
        );
      }

      try {
        await cancelSubscription(household.stripe_subscription_id);
        stripeCancelledAt = new Date().toISOString();
        await admin
          .from('member_deletion_requests')
          .update({ stripe_subscription_cancelled_at: stripeCancelledAt })
          .eq('id', reqRow.id);
      } catch (stripeErr) {
        console.error('Household deletion — subscription cancel failed, nothing deleted (requestId for ops):', reqRow.id, stripeErr);
        await admin
          .from('member_deletion_requests')
          .update({ last_error: `stripe: ${(stripeErr as Error).message ?? String(stripeErr)}` })
          .eq('id', reqRow.id);
        return NextResponse.json(
          {
            error: 'Your subscription could not be cancelled, so nothing has been deleted. Please try again, or contact support@phare.money.',
            code: 'stripe_cancel_failed',
            requestId: reqRow.id,
          },
          { status: 503 }
        );
      }
    }
    // A household with no stripe_subscription_id has nothing to cancel. That is
    // the normal path for every free household — and the ONLY path today, since
    // no subscription exists yet. Note this deliberately does NOT require
    // Stripe to be configured: demanding a key to delete a free household would
    // block deletion for a reason that has nothing to do with the household.

    // ---- 3. Erase every identity, caller last ------------------------------
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

    // ---- 4. Drop the household — cascade takes everything -------------------
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
      // null is a legitimate value: a free household had nothing to cancel.
      subscriptionCancelledAt: stripeCancelledAt,
      ...(result as Record<string, unknown> ?? {}),
    });
  } catch (err) {
    console.error('Household DELETE threw:', err);
    return NextResponse.json({ error: 'Failed to delete household' }, { status: 500 });
  }
}
