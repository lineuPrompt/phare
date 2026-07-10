import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getCallerInfo } from '../route';

/**
 * POST /api/household/members/quick-add — onboarding member discovery.
 *
 * Deliberately NOT the provisioning flow in ../route.ts: this creates a
 * name-only household_members row (user_id stays null — the schema already
 * supports invited-but-not-signed-up members). No auth user, no email, no
 * invite. Access invitation stays exclusively on the Household page's
 * email-based POST — this endpoint exists so onboarding can record "Julia
 * is part of this household" the moment the user confirms it, without
 * granting Julia login access she wasn't asked about.
 *
 * Available to both owner and member roles — unlike provisioning, this
 * carries no access implications, so it doesn't need the owner-only guard.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const caller = await getCallerInfo(supabase);
    if (!caller) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { name } = await request.json() as { name?: string };
    if (!name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const { data: member, error } = await supabase
      .from('household_members')
      .insert({ household_id: caller.householdId, name: name.trim() })
      .select('id, name')
      .single();

    if (error || !member) {
      console.error('Quick-add member error:', error);
      return NextResponse.json({ error: error?.message ?? 'Failed to create member' }, { status: 500 });
    }

    return NextResponse.json({ member });
  } catch (err) {
    console.error('Quick-add member threw:', err);
    return NextResponse.json({ error: 'Failed to create member' }, { status: 500 });
  }
}
