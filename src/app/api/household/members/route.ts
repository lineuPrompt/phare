import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { findMemberNameCandidates } from '@/lib/incomeHelpers';
import {
  isPendingMember,
  householdLocaleFrom,
  isAtMemberCap,
  HOUSEHOLD_MEMBER_CAP,
} from '@/lib/memberProvisioningHelpers';

// ---------------------------------------------------------------------------
// Auth guard — exported for unit testing
//
// Returns the caller's { userId, householdId, role, locale } if authenticated.
// Returns null if unauthenticated or if the users row is missing.
//
// locale is the HOUSEHOLD's locale (embedded from households), not a per-user
// setting — it decides which language an invitee's set-password page opens in.
// ---------------------------------------------------------------------------
export interface CallerInfo {
  userId: string;
  householdId: string;
  role: string;
  locale: 'en' | 'fr';
}

export async function getCallerInfo(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<CallerInfo | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: userRow } = await supabase
    .from('users')
    .select('household_id, role, households(locale)')
    .eq('id', user.id)
    .single();

  if (!userRow?.household_id) return null;

  return {
    userId: user.id,
    householdId: userRow.household_id,
    role: userRow.role,
    locale: householdLocaleFrom((userRow as { households?: unknown }).households),
  };
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

    // NOTE: `users(email, role)` is deliberately NOT embedded here.
    //
    // The users RLS policy is `users_all USING (id = auth.uid())`, so through
    // the caller's own client that embed returns NULL for every member except
    // the caller. It looked like it worked — the page just rendered everyone
    // else as a role-less row, and a `?? 'member'` default on the client made
    // that indistinguishable from a real "member". Two owners displayed as one
    // owner and one member.
    //
    // Roles and emails now come from the service-role client below instead.
    // RLS is untouched: the policy stays as tight as it was, and this route
    // (which already built an admin client to compute `pending`) does the
    // household-scoped read explicitly.
    const { data: members, error } = await supabase
      .from('household_members')
      .select('id, name, user_id')
      .eq('household_id', caller.householdId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('Members GET error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!members || members.length === 0) {
      return NextResponse.json({ members: [] });
    }

    const admin = createAdminClient();

    // One query for the whole household rather than one per member. Scoped by
    // household_id — the service-role client can see every household, so that
    // filter is a real tenant check, not a formality.
    const { data: userRows, error: usersError } = await admin
      .from('users')
      .select('id, email, role')
      .eq('household_id', caller.householdId);

    if (usersError) {
      console.error('Members GET — role lookup failed:', usersError);
      return NextResponse.json({ error: 'Could not read household roles' }, { status: 500 });
    }

    const byUserId = new Map((userRows ?? []).map((u) => [u.id, u]));

    // `users` stays null when there is no account (a name-only member) or when
    // no row came back for one that should exist. The client renders null as
    // "unknown", never as a role — see memberRoleView.
    const withRoles = members.map((m) => {
      const row = m.user_id ? byUserId.get(m.user_id) : undefined;
      return { ...m, users: row ? { email: row.email, role: row.role } : null };
    });

    // Pending status comes from the auth user's last_sign_in_at, which only
    // the Admin API can read — computed owner-only so a member-role caller
    // never triggers per-user Admin API calls for a page they can't act on
    // anyway (the household page is owner-only client-side). The role lookup
    // above is a single household-scoped DB read, so it runs for everyone.
    if (caller.role === 'owner') {
      const withPending = await Promise.all(
        withRoles.map(async (m) => {
          if (!m.user_id) return { ...m, pending: false };
          const { data: authUser } = await admin.auth.admin.getUserById(m.user_id);
          return { ...m, pending: isPendingMember(m.user_id, authUser?.user?.last_sign_in_at ?? null) };
        })
      );
      return NextResponse.json({ members: withPending });
    }

    return NextResponse.json({ members: withRoles });
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
    // 2a. HARD MEMBER CAP — enforced here, on the server, before anything is
    // created. The UI hides the invite form at capacity, but that is
    // presentation: this route is the enforcement, and it must reject a third
    // member whether or not any UI asked it to.
    //
    // Counts rows with a user_id — an account holder OR a pending invite.
    // A pending invite occupies a slot deliberately; otherwise a household
    // could invite unlimited people so long as none of them accepted.
    //
    // EXEMPTION: re-inviting an email that already belongs to THIS household
    // is a resend of an expired invite, not a new member, and must not be
    // blocked at capacity — a household at the cap would otherwise be unable
    // to resend to its own existing member.
    // -----------------------------------------------------------------------
    const normalizedEmail = email.trim().toLowerCase();
    const admin = createAdminClient();

    const { data: alreadyOurs } = await admin
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .eq('household_id', caller.householdId)
      .maybeSingle();

    if (!alreadyOurs) {
      const { count: accessHoldingCount, error: countError } = await supabase
        .from('household_members')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', caller.householdId)
        .not('user_id', 'is', null);

      if (countError) {
        console.error('Member cap count failed:', countError);
        return NextResponse.json({ error: 'Could not verify household capacity' }, { status: 500 });
      }

      if (isAtMemberCap(accessHoldingCount ?? 0)) {
        return NextResponse.json(
          {
            error: `Households are limited to ${HOUSEHOLD_MEMBER_CAP} members.`,
            code: 'member_cap_reached',
            cap: HOUSEHOLD_MEMBER_CAP,
          },
          { status: 409 }
        );
      }
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
    // `admin` is already in scope from the member-cap check above — one
    // service-role client per request, and one consistent name, which is what
    // the RLS read-compatibility check keys off.
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
        //
        // MUST use the admin client. This looks up SOMEBODY ELSE'S row by
        // email, and the users RLS policy is `id = auth.uid()` — through the
        // caller's own client this returned null every time, so the comparison
        // below was always false and the resend branch was unreachable.
        // Re-inviting an existing member of your own household (an expired
        // invite — the common case) fell through to the 409 telling you they
        // belong to another household.
        //
        // The household comparison is what keeps this safe: the admin client
        // can see every household, so the returned row is only acted on when
        // it belongs to the caller's own.
        //
        // Lowercased because Supabase Auth normalizes emails, so the stored
        // row is lowercase while the invite form's input may not be. NOT
        // `ilike` — emails legitimately contain `_`, which is a LIKE wildcard
        // and would match a different address.
        const { data: existingRow } = await admin
          .from('users')
          .select('household_id')
          .eq('email', email.trim().toLowerCase())
          .single();

        if (existingRow?.household_id === caller.householdId) {
          const appOrigin = new URL(request.url).origin;
          await admin.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: `${appOrigin}/auth/callback?next=/${caller.locale}/dashboard`,
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
      { redirectTo: `${appOrigin}/auth/callback?next=/${caller.locale}/dashboard` }
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
