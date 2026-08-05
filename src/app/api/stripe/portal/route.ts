import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getStripe, stripeConfigured } from '@/lib/stripe';

// ---------------------------------------------------------------------------
// POST /api/stripe/portal — a Stripe Customer Portal session.
//
// This is what makes the Terms' "You can cancel your subscription at any time
// from within the app" TRUE. Quebec requires the cancellation mechanism to
// actually work, and the Portal is the smallest thing that provides it — plus
// payment-method updates and invoice history for free.
//
// THE GUARD IS `stripe_customer_id`, NOT `isPro`, and the difference matters in
// both directions:
//
//   - A COMPED household is fully Pro with NO Stripe customer at all. Gating on
//     isPro would send them to billingPortal.sessions.create({ customer: null }),
//     which throws. There is genuinely nothing for them to manage.
//   - A LAPSED household is NOT Pro but still has a customer, and should keep
//     portal access — for invoice history, and to resubscribe.
//
// Owner-only, matching checkout: this is the billing relationship, not the
// benefit. Both members see the STATE; one of them manages it.
//
// WRITES NOTHING. Portal changes come back through the webhook exactly as
// checkout's do — same single writer, same ordering guard. This route creates a
// session and returns a URL, and that is all it does.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id, role')
      .eq('id', user.id)
      .single();

    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household for this account' }, { status: 400 });
    }
    if (userRow.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the household owner can manage the subscription.', code: 'owner_only' },
        { status: 403 }
      );
    }

    if (!stripeConfigured()) {
      console.error('Portal — STRIPE_SECRET_KEY not set');
      return NextResponse.json({ error: 'Billing is unavailable right now.', code: 'not_configured' }, { status: 503 });
    }

    // Service-role read: stripe_customer_id is billing state, written only by
    // the webhook, and not something the caller's own client should need.
    const admin = createAdminClient();
    const { data: household } = await admin
      .from('households')
      .select('stripe_customer_id')
      .eq('id', userRow.household_id)
      .maybeSingle();

    if (!household?.stripe_customer_id) {
      // The comped case, and the never-subscribed case. Refused BEFORE calling
      // Stripe so a comped family gets a sentence rather than a stack trace.
      // The UI omits the button entirely for them — this is the second layer.
      return NextResponse.json(
        { error: 'There is no billing account to manage.', code: 'no_billing_account' },
        { status: 400 }
      );
    }

    const origin = new URL(request.url).origin;
    const locale = new URL(request.url).searchParams.get('locale') === 'fr' ? 'fr' : 'en';

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: household.stripe_customer_id,
      // `portal=1` only tells the UI to show a brief "updating" state. It is
      // never read as truth — the webhook is still the only writer.
      return_url: `${origin}/${locale}/household?portal=1`,
    });

    if (!session.url) {
      console.error('Portal — session created without a url');
      return NextResponse.json({ error: 'Could not open billing.', code: 'no_session_url' }, { status: 502 });
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Portal — threw:', err);
    return NextResponse.json({ error: 'Could not open billing.' }, { status: 500 });
  }
}
