export type SupportedLocale = 'en' | 'fr';

/**
 * Pick the locale for the auth callback's interstitial redirect out of the
 * `next` param it was handed.
 *
 * The callback used to send everyone to /en/set-password, so a French member
 * following a recovery link saw an English "Set your password" page and only
 * landed back in French afterwards. `next` already carries the destination
 * locale (e.g. /fr/dashboard), so it's the honest source — no extra param, no
 * lookup, nothing new for callers to pass.
 *
 * Anything unrecognized falls back to 'en': absent, empty, a bare path with no
 * locale segment, an unsupported locale, or a full URL. This is display copy on
 * a page reached by a one-time token — a wrong guess should degrade to the
 * default language, never throw and strand someone mid-reset.
 */
export function localeFromNext(next: string | null | undefined): SupportedLocale {
  if (!next) return 'en';

  // Tolerate a query string or hash riding along, and an absolute URL.
  const pathOnly = next.split(/[?#]/)[0];
  const firstSegment = pathOnly.split('/').filter(Boolean)[0];

  return firstSegment === 'fr' ? 'fr' : 'en';
}

/**
 * The `sub` (user id) claim of a Supabase access token, or null if the token
 * can't be read. Not a verification: setSession verifies the token with the
 * auth server. This only answers "whose link is this?" so the callback can
 * tell whether an existing session belongs to the same person.
 */
export function jwtSubject(token: string): string | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { sub?: unknown };
    return typeof claims.sub === 'string' && claims.sub ? claims.sub : null;
  } catch {
    return null;
  }
}

/** The slice of the Supabase auth client the callback needs. */
export type CallbackAuth = {
  getSession(): Promise<{ data: { session: { user: { id: string } } | null } }>;
  setSession(tokens: { access_token: string; refresh_token: string }): Promise<{
    data: { user: { id: string } | null };
    error: { message: string } | null;
  }>;
};

/**
 * Make the session the one the emailed link was issued for (launch plan 1.5).
 *
 * THE BUG THIS CLOSES. The callback used to keep ANY existing session and
 * skip the link's tokens. An invite or reset link opened in a browser where
 * someone else was signed in (a partner on a shared laptop) then sent the
 * set-password page to change the signed-in person's password and record
 * their terms, while the invitee's account stayed without a password.
 *
 * Now an existing session is kept only when it is provably the link's own
 * user. Otherwise the link's tokens replace it, and the result is checked:
 * the session must belong to the link's user before anything continues.
 * getSession first also waits out the client's own initialisation, so
 * setSession never runs alongside it.
 */
export async function establishLinkSession(
  auth: CallbackAuth,
  accessToken: string,
  refreshToken: string,
): Promise<{ error: string | null }> {
  const linkUser = jwtSubject(accessToken);

  const { data: { session } } = await auth.getSession();
  if (session && linkUser && session.user.id === linkUser) {
    return { error: null };
  }

  const { data, error } = await auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
  if (error) return { error: error.message };
  if (!data.user || (linkUser && data.user.id !== linkUser)) {
    return { error: 'The sign-in link did not match the account it was sent for' };
  }
  return { error: null };
}
