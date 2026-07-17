import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getCallerInfo } from '../../route';
import { isPendingMember } from '@/lib/memberProvisioningHelpers';

const RATE_LIMIT_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// POST /api/household/members/[id]/resend — regenerate and resend a pending
// member's set-password email.
//
// "Regenerate" matters: resending a stale link would just fail the same way
// the expired one did. Reuses the exact same admin.auth.resetPasswordForEmail
// call the original invite (and its accidental duplicate-email resend path)
// already uses — Supabase issues a fresh recovery token and sends it via its
// own configured mailer/template, no new send path needed.
//
// Owner-gated. Rate-limited server-side (household_members.last_resend_at)
// so a stuck button can't repeatedly burn the mail quota.
// ---------------------------------------------------------------------------
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const caller = await getCallerInfo(supabase);
    if (!caller) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (caller.role !== 'owner') {
      return NextResponse.json({ error: 'Only the household owner can resend invites' }, { status: 403 });
    }

    const { data: member } = await supabase
      .from('household_members')
      .select('id, household_id, user_id, last_resend_at')
      .eq('id', id)
      .single();

    if (!member || member.household_id !== caller.householdId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (!member.user_id) {
      return NextResponse.json({ error: "This member hasn't been invited yet" }, { status: 400 });
    }

    if (member.last_resend_at) {
      const elapsedMs = Date.now() - new Date(member.last_resend_at).getTime();
      if (elapsedMs < RATE_LIMIT_MS) {
        const retryAfterSeconds = Math.ceil((RATE_LIMIT_MS - elapsedMs) / 1000);
        return NextResponse.json(
          { error: `Please wait ${retryAfterSeconds}s before resending.`, retryAfterSeconds },
          { status: 429 }
        );
      }
    }

    const admin = createAdminClient();
    const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(member.user_id);

    if (getUserError || !authUser?.user?.email) {
      console.error('Resend invite — getUserById error (memberId for ops):', member.id, getUserError);
      return NextResponse.json({ error: 'Could not look up this member’s account' }, { status: 500 });
    }

    if (!isPendingMember(member.user_id, authUser.user.last_sign_in_at ?? null)) {
      return NextResponse.json(
        { error: "This member's account is already active — no invite to resend" },
        { status: 400 }
      );
    }

    const appOrigin = new URL(request.url).origin;
    const { error: emailError } = await admin.auth.resetPasswordForEmail(authUser.user.email, {
      redirectTo: `${appOrigin}/auth/callback?next=/en/dashboard`,
    });

    if (emailError) {
      console.error('Resend invite — resetPasswordForEmail error (memberId for ops):', member.id, emailError);
      return NextResponse.json({ error: emailError.message }, { status: 500 });
    }

    const { error: stampError } = await supabase
      .from('household_members')
      .update({ last_resend_at: new Date().toISOString() })
      .eq('id', member.id);
    if (stampError) {
      console.error('Resend invite — last_resend_at stamp error (memberId for ops, email already sent):', member.id, stampError);
    }

    return NextResponse.json({ success: true, email: authUser.user.email });
  } catch (err) {
    console.error('Members resend POST threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
