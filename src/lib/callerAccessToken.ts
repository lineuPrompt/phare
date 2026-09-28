// ---------------------------------------------------------------------------
// The caller's own access token, from wherever it arrived.
//
// Only one route needs the raw token: DELETE /api/me, to revoke every refresh
// token for a departing user (auth.admin.signOut takes a JWT, not a user id).
// It used to read it with supabase.auth.getSession(). That works for the
// browser — the cookie client holds a session — and returns null for the
// mobile app, whose bearer client is built with persistSession: false and no
// stored session. So a mobile self-deletion never signed out, and on the 202
// "partial" path the refresh token outlived the account it belonged to.
// (docs/tickets/bearer-self-delete-skips-global-signout.md)
//
// The route has already verified this caller with auth.getUser() — the token
// is not trusted by being read here, only reused.
// ---------------------------------------------------------------------------

/**
 * `Bearer <token>`, scheme matched case-insensitively per RFC 7235. Anything
 * else — `Basic`, a bare token, an empty scheme — deliberately fails to match
 * and falls through to the cookie path, so a request carrying some unrelated
 * Authorization header behaves exactly as it does today rather than being
 * diverted into a token flow it was never meant for.
 *
 * Shared with supabase-server.ts, which decides the transport by it, so the
 * two can never disagree about what counts as a bearer request.
 */
export const BEARER = /^Bearer\s+(\S+)\s*$/i;

type SessionReader = {
  auth: { getSession: () => Promise<{ data: { session: { access_token?: string } | null } }> };
};

export async function callerAccessToken(request: Request, supabase: SessionReader): Promise<string | null> {
  const bearer = BEARER.exec(request.headers.get('authorization') ?? '');
  if (bearer) return bearer[1];
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}
