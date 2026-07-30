import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase-admin';

const RATE_LIMIT_MS = 60 * 1000;
const RATE_LIMIT_MAX_ENTRIES = 5000;

// In-process rate limiter, keyed by the submitted (normalized) email.
//
// The household-member resend limiter stamps household_members.last_resend_at,
// but that pattern can't be reused verbatim here: this route is unauthenticated
// and the submitted email may not correspond to any row at all — and looking one
// up to decide whether to limit would itself be an account-existence oracle.
// So the same 60s window / 429 + retryAfterSeconds shape is kept, with the
// timestamp held in memory instead of a column.
//
// Keying on the submitted email (not on a found user) is what keeps the limiter
// leak-free: an unknown address is limited exactly like a known one.
//
// Caveat, deliberate for v1: memory is per server instance, so N instances
// allow N sends per window. This still does the job the resend limiter was
// written for — stopping a stuck button or a double-click from burning mail
// quota — and Supabase Auth applies its own per-IP limit underneath. A shared
// store (table or KV) is the upgrade if abuse ever shows up in practice.
const lastSentAt = new Map<string, number>();

function pruneExpired(now: number) {
  for (const [key, at] of lastSentAt) {
    if (now - at >= RATE_LIMIT_MS) lastSentAt.delete(key);
  }
  // Hard cap so a flood of distinct addresses can't grow the map without bound.
  if (lastSentAt.size > RATE_LIMIT_MAX_ENTRIES) lastSentAt.clear();
}

// ---------------------------------------------------------------------------
// POST /api/auth/forgot-password — self-service password reset trigger.
//
// Body: { email: string, locale?: 'en' | 'fr' }
//
// Sends the same recovery email the owner-gated invite and resend routes send
// (admin.auth.resetPasswordForEmail → Supabase's Reset Password template via
// Brevo), landing on the existing /auth/callback → /set-password machinery.
// Nothing about that machinery changes; this route only adds a caller for it
// that doesn't require an owner.
//
// SECURITY POSTURE: the response is identical whether or not the email has an
// account — same status, same body, no timing branch that depends on a lookup.
// Every failure from Supabase is logged server-side and swallowed, because an
// error body here would be exactly the account-existence oracle we're avoiding.
// The only non-200 is the rate limit, which is keyed on the submitted address
// and so is equally reachable for a nonexistent one.
// ---------------------------------------------------------------------------
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const { email, locale } = (body ?? {}) as { email?: unknown; locale?: unknown };

    if (typeof email !== 'string' || !email.includes('@') || email.trim().length < 3) {
      return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const targetLocale = locale === 'fr' ? 'fr' : 'en';

    const now = Date.now();
    pruneExpired(now);

    const previous = lastSentAt.get(normalizedEmail);
    if (previous !== undefined) {
      const elapsedMs = now - previous;
      if (elapsedMs < RATE_LIMIT_MS) {
        const retryAfterSeconds = Math.ceil((RATE_LIMIT_MS - elapsedMs) / 1000);
        return NextResponse.json(
          { error: `Please wait ${retryAfterSeconds}s before requesting another link.`, retryAfterSeconds },
          { status: 429 }
        );
      }
    }

    // Stamp BEFORE sending: if the send throws, we still don't want a retry
    // loop hammering the mailer inside the window.
    lastSentAt.set(normalizedEmail, now);

    // Same redirectTo shape as the invite and resend routes — request origin so
    // it works in dev and prod without another env var.
    const appOrigin = new URL(request.url).origin;

    try {
      const admin = createAdminClient();
      const { error } = await admin.auth.resetPasswordForEmail(normalizedEmail, {
        redirectTo: `${appOrigin}/auth/callback?next=/${targetLocale}/dashboard`,
      });
      if (error) {
        // Includes "user not found" on Supabase versions that report it —
        // never surfaced to the caller.
        console.error('Forgot password — resetPasswordForEmail error (not surfaced to caller):', error);
      }
    } catch (sendErr) {
      console.error('Forgot password — send threw (not surfaced to caller):', sendErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Forgot password POST threw:', err);
    // Even a genuine server fault returns the neutral shape, so a caller can't
    // distinguish "no such account" from "something broke".
    return NextResponse.json({ success: true });
  }
}
