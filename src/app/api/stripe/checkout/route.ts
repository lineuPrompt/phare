import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createAdminClient } from '@/lib/supabase-admin';
import { getStripe, stripeConfigured } from '@/lib/stripe';
import { loadEntitlement } from '@/lib/entitlementServer';

// ---------------------------------------------------------------------------
// POST /api/stripe/checkout — start a Phare Pro subscription.
//
// Body: { plan: 'monthly' | 'annual' }
// Returns: { url } — the Stripe-hosted Checkout Session to redirect to.
//
// THIS ROUTE WRITES NOTHING TO OUR DATABASE. Not the customer id, not the
// subscription, not a "pending" flag. That is the single rule that makes the
// checkout/webhook race disappear: Stripe frequently fires
// checkout.session.completed before the browser finishes redirecting back, so
// if both sides wrote state they would race and the loser would clobber the
// winner. With exactly ONE writer (the webhook, piece 5) there is no race to
// reason about.
//
// It follows that CHECKOUT IS INERT UNTIL PIECE 5. A completed payment grants
// nothing, because nothing is listening. That reads like a half-built feature
// and is in fact the safe direction: it is impossible to sell access before the
// mechanism that records it exists. Do not put a real checkout link in front of
// anyone until the webhook lands.
//
// OWNER-ONLY. One subscription covers the whole household, so this is a
// household-level administrative act — the same bar as inviting a member or
// deleting the household. A member can still use everything the subscription
// unlocks; they just cannot start or change the billing relationship.
// ---------------------------------------------------------------------------

type PlanChoice = 'monthly' | 'annual';

function priceIdFor(plan: PlanChoice): string | undefined {
  return plan === 'annual'
    ? process.env.STRIPE_PRICE_ANNUAL
    : process.env.STRIPE_PRICE_MONTHLY;
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = {};
    }
    const { plan } = (body ?? {}) as { plan?: unknown };

    if (plan !== 'monthly' && plan !== 'annual') {
      return NextResponse.json(
        { error: 'plan must be "monthly" or "annual"', code: 'invalid_plan' },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id, role, email')
      .eq('id', user.id)
      .single();

    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household for this account' }, { status: 400 });
    }
    if (userRow.role !== 'owner') {
      return NextResponse.json(
        { error: 'Only the household owner can start a subscription.', code: 'owner_only' },
        { status: 403 }
      );
    }

    // Already entitled — do not let anyone buy what they already have. A comped
    // household hits this too, which is intended: they should never be charged
    // for a year that was given to them.
    const entitlement = await loadEntitlement(supabase, userRow.household_id);
    if (entitlement.isPro) {
      return NextResponse.json(
        {
          error: 'This household already has Phare Pro.',
          code: 'already_pro',
          reason: entitlement.reason,
        },
        { status: 409 }
      );
    }

    if (!stripeConfigured()) {
      console.error('Checkout — STRIPE_SECRET_KEY is not set');
      return NextResponse.json(
        { error: 'Payments are not available right now.', code: 'stripe_unavailable' },
        { status: 503 }
      );
    }

    const priceId = priceIdFor(plan as PlanChoice);
    if (!priceId) {
      // A missing price id would otherwise surface as an opaque Stripe error on
      // the hosted page, after the redirect, where it looks like a payment
      // failure rather than a configuration one.
      console.error('Checkout — missing price id env var for plan:', plan);
      return NextResponse.json(
        { error: 'Payments are not available right now.', code: 'price_not_configured' },
        { status: 503 }
      );
    }

    // Reuse the customer the WEBHOOK recorded on a previous subscription, if
    // any. Read with the admin client because households is not readable
    // column-by-column through RLS for this purpose, and because this must not
    // depend on the caller's own policy scope.
    const admin = createAdminClient();
    const { data: household } = await admin
      .from('households')
      .select('stripe_customer_id, name')
      .eq('id', userRow.household_id)
      .single();

    const origin = new URL(request.url).origin;
    const locale = request.headers.get('referer')?.includes('/fr') ? 'fr' : 'en';

    const stripe = getStripe();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],

      // Existing customer if the webhook has recorded one; otherwise let Stripe
      // create it from this email. We deliberately do NOT create the customer
      // ourselves — that would be this route writing billing state.
      ...(household?.stripe_customer_id
        ? { customer: household.stripe_customer_id }
        : { customer_email: userRow.email ?? user.email ?? undefined }),

      // BOTH of these carry the household id, on purpose. client_reference_id
      // rides on the Session; metadata is copied onto the Subscription. The
      // webhook needs to identify the household from several different event
      // types, and not all of them carry both.
      client_reference_id: userRow.household_id,
      metadata: { household_id: userRow.household_id },
      subscription_data: {
        metadata: { household_id: userRow.household_id },
      },

      // Stripe Tax is NOT enabled here yet — it collects nothing until tax
      // registrations exist, and whether Phare has them is unresolved. Turning
      // it on is piece 6, together with the Terms sentence about taxes.

      success_url: `${origin}/${locale}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/${locale}/household`,

      // Lets a returning customer manage the subscription later from the same
      // billing relationship rather than accumulating duplicates.
      allow_promotion_codes: false,
    });

    if (!session.url) {
      console.error('Checkout — Stripe returned a session with no URL:', session.id);
      return NextResponse.json(
        { error: 'Could not start checkout. Please try again.', code: 'no_session_url' },
        { status: 502 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error('Checkout threw:', err);
    return NextResponse.json(
      { error: 'Could not start checkout. Please try again.' },
      { status: 500 }
    );
  }
}
