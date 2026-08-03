import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { CURRENT_LEGAL_VERSION } from '@/lib/legalVersions';

// ---------------------------------------------------------------------------
// POST /api/legal/accept — record that this user accepted the Terms and the
// Privacy Policy.
//
// Body: { version: string }  — the version the client actually DISPLAYED.
//
// Called from two places, and it must be both:
//   - the signup form (self-signup, Path A)
//   - /set-password  (invited member, Path B — they never see the signup form,
//                     so capturing only at signup would let an invited spouse
//                     use Phare having consented to nothing)
//
// WHY THE CLIENT SENDS A VERSION IT DOES NOT GET TO CHOOSE. The version is
// validated against CURRENT_LEGAL_VERSION and rejected if it differs, then the
// SERVER's constant is what gets written. That combination is deliberate:
//   - taking the client's value verbatim would let anyone record acceptance of
//     any string, including a document that never existed;
//   - ignoring the client's value entirely would silently record acceptance of
//     the CURRENT text when the user was shown a STALE cached page — recording
//     consent to words they never saw, which is exactly the thing this endpoint
//     exists to be able to prove.
// So a stale client is refused and told to reload, rather than quietly
// producing a false record.
//
// WRITTEN WITH THE SERVICE-ROLE CLIENT. The users RLS policy is `id =
// auth.uid()`, so a user could update their own row — meaning their own consent
// timestamp — from the client. Keeping the write here is what makes the record
// evidence rather than a self-reported claim. Same reasoning that ruled out
// raw_user_meta_data.
//
// IDEMPOTENT: accepting twice just refreshes the timestamp. There is no reason
// to fail a duplicate, and failing one would break a double-click.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { version } = (body ?? {}) as { version?: unknown };

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    if (typeof version !== 'string' || version !== CURRENT_LEGAL_VERSION) {
      return NextResponse.json(
        {
          error: 'These documents have been updated. Please reload and review the current version.',
          code: 'version_mismatch',
          currentVersion: CURRENT_LEGAL_VERSION,
        },
        { status: 409 }
      );
    }

    const admin = createAdminClient();
    const acceptedAt = new Date().toISOString();

    const { error } = await admin
      .from('users')
      .update({
        terms_accepted_at: acceptedAt,
        // The server's constant, never the client's string — see above.
        terms_version: CURRENT_LEGAL_VERSION,
        updated_at: acceptedAt,
      })
      .eq('id', user.id);

    if (error) {
      console.error('Legal accept — update failed (userId for ops):', user.id, error);
      return NextResponse.json({ error: 'Could not record your acceptance' }, { status: 500 });
    }

    return NextResponse.json({
      accepted: true,
      termsAcceptedAt: acceptedAt,
      termsVersion: CURRENT_LEGAL_VERSION,
    });
  } catch (err) {
    console.error('Legal accept threw:', err);
    return NextResponse.json({ error: 'Could not record your acceptance' }, { status: 500 });
  }
}
