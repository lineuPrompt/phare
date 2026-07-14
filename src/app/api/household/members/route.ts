import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { findMemberNameCandidates } from '@/lib/incomeHelpers';

// ---------------------------------------------------------------------------
// Auth guard — exported for unit testing
//
// Returns the caller's { userId, householdId, role } if authenticated.
// Returns null if unauthenticated or if the users row is missing.
// ---------------------------------------------------------------------------
export interface CallerInfo {
  userId: string;
  householdId: string;
  role: string;
}

export async function getCallerInfo(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<CallerInfo | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('household_id, role')
    .eq('id', user.id)
    .single();

  if (!userRow?.household_id) return null;

  return { userId: user.id, householdId: userRow.household_id, role: userRow.role };
}

// ---------------------------------------------------------------------------
// GET /api/household/members — list members of the caller's household
// Available to both owner and member roles.
// ---------------------------------------------------------------------------
export async function GET() {
  try {
    const supabase = await createClient();
    const caller = await getCallerInfo(supabase);
    if (!caller) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: members, error } = await supabase
      .from('household_members')
      .select('id, name, user_id, users(email, role)')
      .eq('household_id', caller.householdId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Members GET error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ members: members ?? [] });
  } catch (err) {
    console.error('Members GET threw:', err);
    return NextResponse.json({ error: 'Failed to list members' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/household/members — provision a new member into the caller's household
//
// Security surface: uses the service-role client which bypasses RLS and can
// do anything. The owner check MUST happen before any Admin API call.
//
// Body: { email: string, fullName: string, role: 'member' | 'owner' }
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    // -----------------------------------------------------------------------
    // 1. Auth + owner check — this guard runs before any Admin API call
    // -----------------------------------------------------------------------
    const supabase = await createClient();
    const caller = await getCallerInfo(supabase);

    if (!caller) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    if (caller.role !== 'owner') {
      return NextResponse.json({ error: 'Only the household owner can provision members' }, { status: 403 });
    }

    // -----------------------------------------------------------------------
    // 2. Validate input
    // -----------------------------------------------------------------------
    const body = await request.json();
    const { email, fullName, role, attachToMemberId, forceNew } = body as {
      email?: string;
      fullName?: string;
      role?: string;
      // Set by the client after a needsDisambiguation response — the owner's
      // explicit choice, never inferred.
      attachToMemberId?: string;
      forceNew?: boolean;
    };

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }
    if (!fullName?.trim()) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }
    if (role !== 'member' && role !== 'owner') {
      return NextResponse.json({ error: 'Role must be member or owner' }, { status: 400 });
    }

    // -----------------------------------------------------------------------
    // 2b. Match-before-create — same rule accounts already follow. A
    // name-only member created during onboarding discovery (user_id null,
    // e.g. quick-add's "Julia") must be ATTACHED when later invited by name,
    // never duplicated. Uses the same tiered matching as the template's
    // Member column (resolveMemberName's rules, exposed here via
    // findMemberNameCandidates so an ambiguous result is visible instead of
    // collapsed to "no match").
    //
    //   - attachToMemberId given  → the owner already chose, from a prior
    //     needsDisambiguation response. Skip matching, validate and attach.
    //   - forceNew given          → the owner chose "create as a new
    //     person" from that same prompt. Skip matching entirely.
    //   - neither given           → run the match:
    //       0 candidates → create as today (no attach).
    //       1 candidate  → unambiguous, attach automatically.
    //       2+ candidates → never guess; return them and stop before
    //         creating anything, so the owner picks attach-vs-new.
    // -----------------------------------------------------------------------
    let attachTargetId: string | null = null;

    if (attachToMemberId) {
      const { data: target } = await supabase
        .from('household_members')
        .select('id, user_id, household_id')
        .eq('id', attachToMemberId)
        .single();
      if (!target || target.household_id !== caller.householdId) {
        return NextResponse.json({ error: 'That member was not found in your household' }, { status: 404 });
      }
      if (target.user_id) {
        return NextResponse.json({ error: 'That member already has an account' }, { status: 409 });
      }
      attachTargetId = attachToMemberId;
    } else if (!forceNew) {
      const { data: nameOnlyMembers } = await supabase
        .from('household_members')
        .select('id, name')
        .eq('household_id', caller.householdId)
        .is('user_id', null);

      const candidates = findMemberNameCandidates(fullName.trim(), nameOnlyMembers ?? []);
      if (candidates.length > 1) {
        return NextResponse.json({
          needsDisambiguation: true,
          candidates: candidates.map((c) => ({ id: c.id, name: c.name })),
        });
      }
      if (candidates.length === 1) {
        attachTargetId = candidates[0].id;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Use Admin API (service role) to create the auth user
    //
    // Metadata is written into raw_user_meta_data — the handle_new_user
    // trigger reads household_id from there to skip household creation.
    //
    // email_confirm: true so the member doesn't need a separate verify step;
    // they set their password via the recovery link instead.
    // -----------------------------------------------------------------------
    const admin = createAdminClient();

    const { data: newUser, error: createError } = await admin.auth.admin.createUser({
      email: email.trim(),
      email_confirm: true,
      user_metadata: {
        household_id: caller.householdId,
        role,
        full_name: fullName.trim(),
      },
    });

    if (createError) {
      console.error('Admin createUser error:', createError);
      const alreadyExists =
        createError.message.toLowerCase().includes('already registered') ||
        createError.message.toLowerCase().includes('already exists') ||
        (createError as { status?: number }).status === 422;

      if (alreadyExists) {
        // Check if this email is already a member of the caller's own household.
        // If yes: the previous invite email likely expired — resend it.
        // If no:  the email belongs to a different household → 409.
        const { data: existingRow } = await supabase
          .from('users')
          .select('household_id')
          .eq('email', email.trim())
          .single();

        if (existingRow?.household_id === caller.householdId) {
          const appOrigin = new URL(request.url).origin;
          await admin.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${appOrigin}/auth/callback?next=/en/dashboard`,
          });
          return NextResponse.json({ success: true, resent: true });
        }

        return NextResponse.json(
          { error: 'This email already has a Phare account. A person can only belong to one household — they would need to delete their existing account first.' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }

    // -----------------------------------------------------------------------
    // 3b. Attach-and-cleanup. handle_new_user() (the signup trigger) ALWAYS
    // inserts a brand-new household_members row for the new auth user —
    // that's unconditional, unrelated to matching. When we matched an
    // existing name-only member above, re-point that identity onto the
    // EXISTING row (which may carry real recurring_items/transactions/
    // budgets attribution — see the household_members merge script for the
    // list) and delete the trigger's just-created duplicate instead. This is
    // simpler and safer than re-pointing every FK: nothing references a row
    // that's milliseconds old, so deleting it is trivially safe, while the
    // existing row's id — and everything already pointing at it — never
    // changes.
    // -----------------------------------------------------------------------
    let attached = false;
    let attachedTo: string | null = null;

    if (attachTargetId && newUser.user) {
      const { data: existingRow } = await supabase
        .from('household_members')
        .select('name')
        .eq('id', attachTargetId)
        .single();

      if (existingRow) {
        const mergedName = fullName.trim().length > existingRow.name.trim().length
          ? fullName.trim()
          : existingRow.name;

        const { error: attachError } = await supabase
          .from('household_members')
          .update({ user_id: newUser.user.id, name: mergedName })
          .eq('id', attachTargetId);

        if (attachError) {
          console.error('Member attach-on-invite update error (userId for ops):', newUser.user.id, attachError);
        } else {
          attached = true;
          attachedTo = mergedName;

          const { data: duplicateRow } = await supabase
            .from('household_members')
            .select('id')
            .eq('user_id', newUser.user.id)
            .neq('id', attachTargetId)
            .maybeSingle();

          if (duplicateRow) {
            const { error: cleanupError } = await supabase
              .from('household_members')
              .delete()
              .eq('id', duplicateRow.id);
            if (cleanupError) {
              console.error('Member attach-on-invite duplicate cleanup error (row left behind, needs manual removal via the merge script):', duplicateRow.id, cleanupError);
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 4. Send the set-password email via resetPasswordForEmail.
    //    redirectTo must use the incoming request origin so it works in both
    //    dev and prod without an extra env var.
    //    Template: Supabase → Authentication → Email Templates → Reset Password
    // -----------------------------------------------------------------------
    const appOrigin = new URL(request.url).origin;
    const { error: emailError } = await admin.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${appOrigin}/auth/callback?next=/en/dashboard` }
    );

    if (emailError) {
      console.error('resetPasswordForEmail error (userId for ops):', newUser.user?.id, emailError);
      return NextResponse.json(
        { error: 'Member created but failed to send set-password email. Use Supabase dashboard → Authentication → Users to send a password reset manually.' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, attached, attachedTo });
  } catch (err) {
    console.error('Members POST threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
