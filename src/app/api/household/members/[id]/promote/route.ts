import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getCallerInfo } from '../../route';
import { isPendingMember } from '@/lib/memberProvisioningHelpers';
import { logEvent } from '@/lib/eventLogger';

// ---------------------------------------------------------------------------
// POST /api/household/members/[id]/promote — make an existing member an owner.
//
// WHY THIS ROUTE EXISTS AT ALL: role was previously assignable only once, at
// invite time. There was no way to promote anyone afterwards, so the last
// owner of a household could never hand off — which is what makes account
// deletion unsafe (delete the last owner and the household survives with
// nobody able to administer it).
//
// WHY SERVICE ROLE: the users RLS policy is `users_all USING (id = auth.uid())`
// — a caller can only touch their OWN users row. Promoting somebody else is
// therefore impossible under the caller's own permissions, by design. That
// constraint is load-bearing and is NOT worked around by loosening the policy;
// instead this route does the write with the service-role client after
// checking, itself, everything RLS would have checked.
//
// Because service role bypasses RLS entirely, every guard below is mandatory
// and the final UPDATE is scoped by household_id as well as id — a tenant
// check the database is no longer performing on our behalf.
//
// Deliberately additive: this promotes, it does not demote or transfer.
// Multiple owners are already a supported concept (the invite form offers the
// owner role), so nothing needs to be taken away for someone to be added.
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
      return NextResponse.json({ error: 'Only a household owner can promote a member' }, { status: 403 });
    }

    // Read through the caller's own (RLS-scoped) client, so a member id from
    // another household simply isn't visible here.
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
        { error: "This member hasn't been invited yet — invite them before making them an owner" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();

    const { data: targetRow } = await admin
      .from('users')
      .select('id, role, household_id')
      .eq('id', member.user_id)
      .single();

    if (!targetRow || targetRow.household_id !== caller.householdId) {
      // Service role can see every household, so this mismatch is a real
      // tenant check, not a formality.
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    if (targetRow.role === 'owner') {
      return NextResponse.json({ error: 'This member is already an owner' }, { status: 400 });
    }

    // A promoted member who never set a password is the ownerless state
    // wearing a hat — they'd hold the role without being able to sign in and
    // use it. last_sign_in_at is only readable with the service-role client.
    const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(member.user_id);
    if (getUserError || !authUser?.user) {
      console.error('Promote — getUserById failed (memberId for ops):', member.id, getUserError);
      return NextResponse.json({ error: 'Could not look up this member’s account' }, { status: 500 });
    }
    if (isPendingMember(member.user_id, authUser.user.last_sign_in_at ?? null)) {
      return NextResponse.json(
        { error: 'This member hasn’t set their password yet. They must sign in once before they can be made an owner.' },
        { status: 400 }
      );
    }

    const { error: updateError } = await admin
      .from('users')
      .update({ role: 'owner' })
      .eq('id', member.user_id)
      .eq('household_id', caller.householdId); // tenant check — RLS is bypassed here

    if (updateError) {
      console.error('Promote — role update failed (memberId for ops):', member.id, updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    // Role changes are exactly the kind of thing you want a trail of.
    await logEvent(supabase, caller.householdId, caller.userId, 'member_promoted_to_owner', {
      member_id: member.id,
      promoted_user_id: member.user_id,
    });

    return NextResponse.json({ success: true, name: member.name });
  } catch (err) {
    console.error('Promote POST threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
