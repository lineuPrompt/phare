import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { getHouseholdTimezone } from '@/lib/householdTimezone';

// GET /api/household/timezone
// The household's IANA timezone — the client-side counterpart to every
// server route's getHouseholdTimezone() call. Client "today"/"current month"
// derivations (form defaults, the timeline's today-marker) must resolve
// against this, not the browser's guessed local clock, so client and server
// agree on what day it is for this household.
export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users').select('household_id').eq('id', user.id).single();
    if (!userRow?.household_id) return NextResponse.json({ error: 'No household' }, { status: 400 });

    const timezone = await getHouseholdTimezone(supabase, userRow.household_id as string);
    return NextResponse.json({ timezone });
  } catch {
    return NextResponse.json({ error: 'Failed to load timezone' }, { status: 500 });
  }
}
