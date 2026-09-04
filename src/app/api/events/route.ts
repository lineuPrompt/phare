import { NextResponse, after } from 'next/server';
import { createClient } from '@/lib/supabase-server';
import { createRateLimiter, clientIp } from '@/lib/rateLimit';
import { validateClientEvent } from '@/lib/clientEvents';

// ---------------------------------------------------------------------------
// POST /api/events — the only channel by which the browser can write a funnel
// event.
//
// Body: { type: string, metadata?: Record<string, string> }
// Returns 204 on success. Returns 204 on a persistence failure too — see below.
//
// ---------------------------------------------------------------------------
// THE ALLOWLIST IS THE POINT. `type` is validated against
// CLIENT_EVENT_ALLOWLIST (src/lib/clientEvents.ts) and refused if it is not an
// own-property of it. That file carries the full reasoning; the short version
// is that events.event_type is unconstrained text and two spend-limit counters
// read rows out of that same table by type, so a client that could name its
// own event_type could write into a billing counter.
//
// THE HOUSEHOLD IS DERIVED, NEVER ASSERTED. household_id comes from `users`
// keyed on the verified user.id, exactly as every other route does it. There
// is no household field in the request body, so there is nothing for a caller
// to lie in — the same posture supabase-server.ts documents.
//
// ---------------------------------------------------------------------------
// WHY THE INSERT IS IN after(), AND WHY IT IS NOT `void`.
//
// The standing requirement is that a funnel event never blocks or slows a user
// action, so `await`ing the insert before responding is out — that is the
// pattern save-plan/expenses/accounts already use for their events, and it is
// specifically the thing not to copy onto the onboarding path.
//
// But bare `void supabase.from(...).insert(...)` is not the answer either.
// Unawaited work in a serverless invocation can be cut short when the function
// context is frozen after the response flushes, so `void` is fire-and-forget
// AND intermittently lossy. Lossy is fatal for funnel arithmetic: a drop rate
// computed from events that sometimes fail to persist is indistinguishable
// from a real drop-off, which is the exact confusion this whole exercise
// exists to end.
//
// after() gives both properties: the work is scheduled once the response is
// sent, so it is off the caller's critical path, and Next keeps the invocation
// alive until it finishes, so it actually runs.
//
// A FAILED INSERT STILL RETURNS 204. By the time after() runs, the response is
// already on the wire — there is no status left to change. The failure is
// logged for the server log and nothing else; the browser could not usefully
// react to it, and emitClientEvent ignores the status anyway.
// ---------------------------------------------------------------------------

// Generous relative to real use: a complete onboarding fires two of these.
// This is here to bound row-spam into a shared table by an authenticated
// client, not to shape legitimate traffic. Per-instance like every other
// limiter in this codebase (see rateLimit.ts's caveat) — a small multiple of
// 30 is still a bound, and the exposure here is table growth rather than
// Anthropic spend.
const rateLimit = createRateLimiter({ windowMs: 5 * 60 * 1000, max: 30 });

export async function POST(request: Request) {
  try {
    const limit = rateLimit(clientIp(request));
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many events', code: 'rate_limited' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } }
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    // Validated BEFORE the auth round trip: a malformed or disallowed type is
    // a developer error at a call site, and there is no reason to spend a
    // getUser() hop confirming who sent it.
    const validated = validateClientEvent(body);
    if (!validated.ok) {
      // The rejected type is deliberately NOT echoed. It is caller-controlled
      // text and this response has no use for it; the reason code is what a
      // developer needs, and the server log below carries the rest.
      console.warn('[events] rejected client event:', validated.reason);
      return NextResponse.json(
        { error: 'Unrecognised event', code: validated.reason },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('household_id')
      .eq('id', user.id)
      .single();

    if (!userRow?.household_id) {
      return NextResponse.json({ error: 'No household' }, { status: 400 });
    }

    const householdId = userRow.household_id as string;
    const { type, metadata } = validated;

    after(async () => {
      const { error } = await supabase.from('events').insert({
        household_id: householdId,
        user_id: user.id,
        event_type: type,
        metadata,
      });
      if (error) {
        console.error(`[events] insert ${type} failed:`, error.message);
      }
    });

    // 204: nothing to say, and nothing the caller reads. Kept deliberately
    // bodyless so no future edit starts returning state a fire-and-forget
    // emitter would have to begin caring about.
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[events] POST threw:', err);
    return NextResponse.json({ error: 'Could not record event' }, { status: 500 });
  }
}
