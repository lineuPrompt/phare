import { NextResponse } from 'next/server';
import { appleDeps, AppleNotConfiguredError } from '@/lib/apple/appleConfig';
import { AppleSyncError, handleNotification } from '@/lib/apple/appleSync';
import { AppleMappingError } from '@/lib/apple/appleSubscriptionMap';

// ---------------------------------------------------------------------------
// POST /api/apple/notifications   { signedPayload: string }
//
// App Store Server Notifications V2. Set this URL in App Store Connect (the
// app → App Information → App Store Server Notifications), for BOTH
// Production and Sandbox: https://phare.money/api/apple/notifications
//
// No session: the caller is Apple, and what proves it is Apple's signature on
// signedPayload, verified to Apple's root before anything is read.
//
// RESPONSES AND APPLE'S RETRIES. Apple retries a notification that does not
// get a 2xx (several times, over days). So:
//   200  handled — applied, stale, test, or about nobody we know (logged
//        loudly; a retry cannot change it), or refused for a reason a
//        person must look at (also logged)
//   400  not signed by Apple, or not a notification at all
//   503  not configured yet — Apple's retry IS the fix, once the key is set
//   500  anything else (Apple's API down, our database down) — retry
// ---------------------------------------------------------------------------

const MAX_BODY_CHARS = 64_000;

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: 'Request too large', code: 'payload_too_large' }, { status: 413 });
  }
  let signedPayload: unknown;
  try {
    signedPayload = (JSON.parse(raw) as { signedPayload?: unknown })?.signedPayload;
  } catch {
    return NextResponse.json({ error: 'Body is not JSON', code: 'invalid_body' }, { status: 400 });
  }
  if (typeof signedPayload !== 'string' || !signedPayload.trim()) {
    return NextResponse.json({ error: 'signedPayload is required', code: 'invalid_body' }, { status: 400 });
  }

  try {
    const result = await handleNotification(appleDeps(), signedPayload);
    if (result.outcome === 'household_unknown') {
      console.error(
        'Apple notification — NO HOUSEHOLD for subscription %s: not linked and no usable appAccountToken.',
        result.originalTransactionId
      );
    }
    return NextResponse.json({ received: true, outcome: result.outcome });
  } catch (err) {
    if (err instanceof AppleNotConfiguredError) {
      console.error('Apple notification — not configured:', err.message);
      return NextResponse.json({ error: err.message, code: 'apple_not_configured' }, { status: 503 });
    }
    if (err instanceof AppleSyncError && err.code === 'invalid_signature') {
      console.error('Apple notification — signature did not verify:', err.message);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 400 });
    }
    if (err instanceof AppleSyncError || err instanceof AppleMappingError) {
      // belongs_to_other_household, household_missing, unusable data: a person
      // must look; a retry of the same bytes will not help.
      console.error('Apple notification — NOT APPLIED:', err.code, err.message);
      return NextResponse.json({ received: true, outcome: 'not_applied', code: err.code });
    }
    console.error('Apple notification — failed, Apple will retry:', err);
    return NextResponse.json({ error: (err as Error)?.message ?? String(err), code: 'apple_notification_failed' }, { status: 500 });
  }
}
