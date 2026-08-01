import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getCallerInfo } from '../route';
import { isPendingMember } from '@/lib/memberProvisioningHelpers';
import { logEvent } from '@/lib/eventLogger';

// ---------------------------------------------------------------------------
// DELETE /api/household/members/[id] — revoke a PENDING invite.
//
// Exists because the household member cap is hard: without this, one typo'd
// email address would consume one of a household's two slots permanently.
//
// WHAT IT DOES, precisely: deletes the invited person's auth.users row. The
// existing cascades do the rest — users cascades from auth.users, and
// household_members.user_id is ON DELETE SET NULL, so the member row REVERTS
// TO NAME-ONLY rather than disappearing.
//
// That last part is deliberate and load-bearing. Match-before-create attaches
// an invite to an existing name-only row, which may already carry real
// attribution (transactions, budgets, recurring items point at that member
// id). Deleting the row would take that history with it — and
// transactions.member_id is NO ACTION, so it would fail anyway. Reverting to
// name-only frees the cap slot (nothing with a user_id remains) while leaving
// the household's ledger exactly as it was.
//
// SCOPE: pending invites only. A member who has actually signed in is a
// person with their own account, and removing them is account deletion — a
// different feature with its own semantics, confirmation, and erasure rules.
// This route refuses them rather than quietly doing half of it.
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const caller = await getCallerInfo(supabase);
    if (!caller) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    if (caller.role !== 'owner') {
      return NextResponse.json({ error: 'Only the household owner can remove a member' }, { status: 403 });
    }

    const { data: member } = await supabase
      .from('household_members')
      .select('id, household_id, user_id, name')
      .eq('id', id)
      .single();

    if (!member || member.household_id !== caller.householdId) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (!member.user_id) {
      return NextResponse.json(
        { error: 'This member has no invite to revoke' },
        { status: 400 }
      );
    }
    if (member.user_id === caller.userId) {
      // Deleting your own account is a different feature entirely.
      return NextResponse.json({ error: 'You cannot remove yourself here' }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(member.user_id);
    if (getUserError || !authUser?.user) {
      console.error('Revoke invite — getUserById failed (memberId for ops):', member.id, getUserError);
      return NextResponse.json({ error: 'Could not look up this member’s account' }, { status: 500 });
    }

    if (!isPendingMember(member.user_id, authUser.user.last_sign_in_at ?? null)) {
      return NextResponse.json(
        {
          error: 'This member has already signed in. Removing an active member is account deletion, not invite revocation.',
          code: 'member_active',
        },
        { status: 400 }
      );
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(member.user_id);
    if (deleteError) {
      console.error('Revoke invite — deleteUser failed (memberId for ops):', member.id, deleteError);
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    await logEvent(supabase, caller.householdId, caller.userId, 'pending_member_removed', {
      member_id: member.id,
      removed_user_id: member.user_id,
    });

    return NextResponse.json({ success: true, name: member.name });
  } catch (err) {
    console.error('Member DELETE threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
