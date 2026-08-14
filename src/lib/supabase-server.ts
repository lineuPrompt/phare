import { createServerClient } from '@supabase/ssr';
import { createClient as createTokenClient } from '@supabase/supabase-js';
import { cookies, headers } from 'next/headers';

// ---------------------------------------------------------------------------
// ONE authenticated Supabase client for every API route, from either of the
// two ways a credential can arrive.
//
//   - Browser  → the session lives in cookies (@supabase/ssr). Unchanged.
//   - Native   → the session lives on the device, and the access token arrives
//                as `Authorization: Bearer <jwt>`. A native client has no
//                cookie jar to read, so the cookie adapter would find nothing
//                and every route would 401.
//
// WHY THIS IS ONE FILE AND NOT 37. Every route already calls createClient()
// and then `supabase.auth.getUser()`. Neither of those has to change: the
// difference between the two transports is entirely about how this function
// builds the client, and nothing downstream can tell the difference — see
// THE SECURITY POSTURE below for why that is safe rather than merely
// convenient.
//
// THE COOKIE PATH IS BYTE-IDENTICAL. It is the same createServerClient call
// with the same adapter it has always had. The bearer branch is only ever
// entered when a well-formed `Bearer` header is actually present, and no
// browser code in this app sends one — the only Authorization header anywhere
// in the codebase is the CRON_SECRET that Vercel Cron sends to
// /api/cron/monthly-reviews, and that route uses createAdminClient() and
// never touches this function. (If it ever did, the CRON_SECRET would be
// offered to Supabase as if it were a user JWT and getUser() would reject it —
// a 401, not a privilege escalation, but a confusing one. Don't wire it here.)
//
// ---------------------------------------------------------------------------
// THE SECURITY POSTURE — why accepting credentials from a new place does not
// widen the blast radius.
//
// 1. THE TOKEN IS NEVER TRUSTED LOCALLY. Nothing here decodes the JWT or reads
//    a claim out of it. `auth.getUser()` issues a real request to Supabase's
//    auth server, which verifies the signature against the project's signing
//    key, checks expiry, and checks that the token's session_id still refers
//    to a live session. A forged, expired, or signed-out token yields
//    `user === null`, and every route already treats that as 401.
//
//    This is deliberately the slower option. Decoding the JWT in-process would
//    save a round trip and would also keep honouring tokens belonging to
//    sessions that have since been signed out or revoked. It is worth the hop.
//
// 2. THE HOUSEHOLD IS DERIVED, NEVER ASSERTED. Routes read household_id from
//    `users` keyed on the verified `user.id`. No route reads a household from
//    anything the caller sent, so there is no field for a caller to lie in.
//
// 3. RLS IS UNAFFECTED, because it never saw the transport in the first place.
//    The same token goes out as the `Authorization` header on every PostgREST
//    request. The API gateway verifies it before PostgREST runs, populates
//    `request.jwt.claims`, and `auth_household_id()` resolves from `auth.uid()`
//    out of those verified claims. A cookie-derived token and a header-derived
//    token produce the identical database session — RLS cannot distinguish them
//    and does not need to.
//
// 4. THE ANON KEY GRANTS NOTHING ON ITS OWN. It is a separate header (`apikey`)
//    and is already public. All 20 tables have RLS with
//    `USING (household_id = auth_household_id())`; with no valid JWT,
//    auth_household_id() is null and no row matches.
//
// SO: presenting a bearer token for a user in another household requires
// already holding that user's valid, unexpired, unrevoked access token — which
// is the same position an attacker holding their session cookie is in today.
// This adds a way to PRESENT a credential, not a way to OBTAIN one.
//
// The one property that genuinely changes is exposure in transit: Authorization
// headers are more likely to be captured by intermediaries and request logs
// than cookies are. Nothing in this codebase logs raw headers, and nothing
// should start.
// ---------------------------------------------------------------------------

/**
 * `Bearer <token>`, scheme matched case-insensitively per RFC 7235. Anything
 * else — `Basic`, a bare token, an empty scheme — deliberately fails to match
 * and falls through to the cookie path, so a request carrying some unrelated
 * Authorization header behaves exactly as it does today rather than being
 * diverted into a token flow it was never meant for.
 */
const BEARER = /^Bearer\s+(\S+)\s*$/i;

export async function createClient() {
  const headerStore = await headers();
  const bearer = BEARER.exec(headerStore.get('authorization') ?? '');

  if (bearer) {
    // The token is re-emitted with a normalized scheme rather than forwarded
    // verbatim: PostgREST expects exactly `Bearer`, and a client that sent
    // `bearer` in lowercase would otherwise authenticate against the auth
    // server (which is case-insensitive) but read zero rows from the database.
    // That failure looks like an empty household, not an auth error.
    const token = bearer[1];

    return createTokenClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: {
          // Supplying an Authorization header in `global.headers` is what makes
          // `auth.getUser()` work with no stored session: supabase-js sets
          // `hasCustomAuthorizationHeader`, and auth-js then skips its
          // "no session" short-circuit and issues GET /auth/v1/user carrying
          // this header. Without the header it would return
          // AuthSessionMissingError and every native request would 401.
          persistSession: false,
          // No background refresh timer. The device owns its own refresh
          // lifecycle; a server-side timer per request would be a leak, and in
          // a serverless invocation it would never fire anyway.
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      }
    );
  }

  // ── Cookie path — unchanged ───────────────────────────────────────────────
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component — safe to ignore,
            // middleware refreshes sessions.
          }
        },
      },
    }
  );
}
