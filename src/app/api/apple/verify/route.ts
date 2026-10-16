import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { loadEntitlement } from '@/lib/entitlementServer';
import { appleDeps, AppleNotConfiguredError } from '@/lib/apple/appleConfig';
import { AppleSyncError, verifyPurchase } from '@/lib/apple/appleSync';
import { AppleMappingError } from '@/lib/apple/appleSubscriptionMap';

// ---------------------------------------------------------------------------
// POST /api/apple/verify   { signedTransaction: string }
//
// The app's call after an App Store purchase or a Restore Purchases: the
// signed transaction StoreKit returned. The server verifies Apple's signature,
// checks the purchase was made for the caller's household (appAccountToken),
// fetches the subscription's live state from Apple, and mirrors it onto the
// household. Answers with the entitlement as it now reads, so the app shows
// Pro from the server's answer, never from its own guess.
//
// Every refusal names its reason (`code`), and the status says what kind of
// failure it is — the app maps codes to its own bilingual text.
// ---------------------------------------------------------------------------

/** A StoreKit 2 signed transaction is a few kilobytes. Past this it is not one. */
const MAX_BODY_CHARS = 32_000;

const STATUS_FOR: Record<string, number> = {
  invalid_signature: 400,
  account_token_mismatch: 403,
  belongs_to_other_household: 409,
  household_missing: 404,
  subscription_not_found: 404,
};

export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARS) {
    return NextResponse.json({ error: 'Request too large', code: 'payload_too_large' }, { status: 413 });
  }
  let signedTransaction: unknown;
  try {
    signedTransaction = (JSON.parse(raw) as { signedTransaction?: unknown })?.signedTransaction;
  } catch {
    return NextResponse.json({ error: 'Body is not JSON', code: 'invalid_body' }, { status: 400 });
  }
  if (typeof signedTransaction !== 'string' || !signedTransaction.trim()) {
    return NextResponse.json({ error: 'signedTransaction is required', code: 'invalid_body' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  const { data: userRow, error: userErr } = await supabase.from('users').select('household_id').eq('id', user.id).single();
  if (userErr || !userRow?.household_id) {
    return NextResponse.json({ error: 'No household', code: 'no_household' }, { status: 400 });
  }
  const householdId = userRow.household_id as string;

  try {
    const result = await verifyPurchase(appleDeps(), householdId, signedTransaction);
    const entitlement = await loadEntitlement(supabase, householdId);
    return NextResponse.json({ outcome: result.outcome, entitlement });
  } catch (err) {
    if (err instanceof AppleNotConfiguredError) {
      console.error('Apple verify — not configured:', err.message);
      return NextResponse.json({ error: err.message, code: 'apple_not_configured' }, { status: 503 });
    }
    if (err instanceof AppleSyncError) {
      console.error('Apple verify — refused:', err.code, err.message, 'household', householdId);
      return NextResponse.json({ error: err.message, code: err.code }, { status: STATUS_FOR[err.code] ?? 400 });
    }
    if (err instanceof AppleMappingError) {
      console.error('Apple verify — unusable Apple data:', err.code, err.message, 'household', householdId);
      return NextResponse.json({ error: err.message, code: err.code }, { status: 422 });
    }
    console.error('Apple verify — failed:', err);
    return NextResponse.json({ error: (err as Error)?.message ?? String(err), code: 'apple_verify_failed' }, { status: 502 });
  }
}
