import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';

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
    const { email, fullName, role } = body as {
      email?: string;
      fullName?: string;
      role?: string;
    };

    if (!email?.trim()) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }
    if (!fullName?.trim()) {
      return NextResponse.json({ error: 'Full name is required' }, { status: 400 });
    }
    if (role !== 'member' && role !== 'owner') {
      return NextResponse.json({ error: 'Role must be member or owner' }, { status: 400 });
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
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }

    // -----------------------------------------------------------------------
    // 4. Generate a set-password link (type: recovery)
    //
    // The member receives this link, clicks it, sets their own password,
    // and signs in. No plaintext credential is ever sent.
    // -----------------------------------------------------------------------
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: email.trim(),
    });

    if (linkError || !linkData?.properties?.action_link) {
      // Member was created but link failed. This is recoverable (owner can
      // generate a new link later) but we surface the error rather than silently failing.
      console.error('generateLink error:', linkError);
      return NextResponse.json(
        {
          error: 'Member created but failed to generate set-password link. Use Supabase dashboard to send a password reset.',
          userId: newUser.user?.id,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      userId: newUser.user?.id,
      setPasswordLink: linkData.properties.action_link,
    });
  } catch (err) {
    console.error('Members POST threw:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
