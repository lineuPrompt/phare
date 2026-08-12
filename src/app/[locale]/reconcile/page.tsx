// The Audit page — INTERNAL ONLY as of 2026-08-12.
//
// This is now a SERVER component whose entire job is the gate. The UI lives in
// ReconcileClient; it is not imported into the response at all unless the check
// below passes, so there is no flash of audit chrome before a redirect and
// nothing about the page in the HTML a stranger receives.
//
// notFound(), not redirect(): a redirect confirms the route exists and that
// something is being withheld. A 404 says there is nothing here, which — for
// everyone not on the allowlist — is the true answer. Same reason the API
// routes behind it answer 404 rather than 403.
//
// This is the boundary, not a decoration: /api/reconcile and
// /api/reconcile/months carry the identical check, so the data is unreachable
// even for someone who calls them directly.
//
// A signed-out visitor also gets the 404 rather than a sign-in redirect —
// bouncing them to /signin would advertise that signing in is the way in.
//
// If this 404s for YOU: PHARE_INTERNAL_HOUSEHOLD_IDS is unset or missing your
// household id in this environment. See src/lib/internalAccess.ts.

import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase-server';
import { isInternalHousehold } from '@/lib/internalAccess';
import ReconcileClient from '@/components/reconcile/ReconcileClient';

export default async function ReconcilePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) notFound();

  const { data: userRow } = await supabase
    .from('users')
    .select('household_id')
    .eq('id', user.id)
    .single();

  if (!isInternalHousehold(userRow?.household_id)) notFound();

  return <ReconcileClient />;
}
