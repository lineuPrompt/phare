import { describe, it, expect } from 'vitest';
import { establishLinkSession, jwtSubject, localeFromNext, type CallbackAuth } from '../authCallbackHelpers';

// The auth callback sends recovery links through a set-password interstitial.
// It used to hardcode /en/, so French members setting a password saw an
// English page. The locale now comes from the `next` param — these pin that
// mapping, and pin that anything unrecognized degrades to 'en' rather than
// throwing, since this runs mid-reset on a one-time token.

describe('localeFromNext', () => {
  it('carries fr through', () => {
    expect(localeFromNext('/fr/dashboard')).toBe('fr');
  });

  it('carries en through', () => {
    expect(localeFromNext('/en/dashboard')).toBe('en');
  });

  it('falls back to en when next is absent', () => {
    expect(localeFromNext(null)).toBe('en');
    expect(localeFromNext(undefined)).toBe('en');
    expect(localeFromNext('')).toBe('en');
  });

  it('falls back to en on a garbled or locale-less next', () => {
    for (const garbled of ['/', '///', 'dashboard', '/dashboard', '/es/dashboard', '/EN/dashboard', '   ']) {
      expect(localeFromNext(garbled)).toBe('en');
    }
  });

  it('reads the locale from deeper paths, not just /dashboard', () => {
    expect(localeFromNext('/fr/goals')).toBe('fr');
    expect(localeFromNext('/fr/household/members')).toBe('fr');
  });

  it('ignores a query string or hash riding along', () => {
    expect(localeFromNext('/fr/dashboard?tab=plan')).toBe('fr');
    expect(localeFromNext('/fr/dashboard#section')).toBe('fr');
    expect(localeFromNext('/en/dashboard?next=/fr/elsewhere')).toBe('en');
  });

  it('does not mistake a URL scheme for a locale', () => {
    expect(localeFromNext('https://phare.money/fr/dashboard')).toBe('en');
  });
});

// ---------------------------------------------------------------------------
// Launch plan 1.5. An invite or reset link opened where someone else is
// signed in used to keep THAT session, so set-password changed the wrong
// person's password. The session must end up as the link's own user.
// ---------------------------------------------------------------------------

function tokenFor(sub: unknown): string {
  const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub, role: 'authenticated' })}.sig`;
}

function fakeAuth(opts: {
  signedIn: string | null;
  setSessionResult?: { userId: string | null; error?: string };
}) {
  const setSessionCalls: { access_token: string; refresh_token: string }[] = [];
  const auth: CallbackAuth = {
    getSession: async () => ({
      data: { session: opts.signedIn ? { user: { id: opts.signedIn } } : null },
    }),
    setSession: async (tokens) => {
      setSessionCalls.push(tokens);
      const r = opts.setSessionResult ?? { userId: null };
      return {
        data: { user: r.userId ? { id: r.userId } : null },
        error: r.error ? { message: r.error } : null,
      };
    },
  };
  return { auth, setSessionCalls };
}

describe('jwtSubject', () => {
  it('reads the user id out of an access token', () => {
    expect(jwtSubject(tokenFor('invitee-id'))).toBe('invitee-id');
  });

  it('returns null for anything it cannot read, never throws', () => {
    expect(jwtSubject('not-a-jwt')).toBeNull();
    expect(jwtSubject('a.%%%.c')).toBeNull();
    expect(jwtSubject(tokenFor(42))).toBeNull();
    expect(jwtSubject(tokenFor(''))).toBeNull();
  });
});

describe('establishLinkSession', () => {
  it('someone ELSE signed in: the link\'s tokens replace their session', async () => {
    const { auth, setSessionCalls } = fakeAuth({
      signedIn: 'partner-id',
      setSessionResult: { userId: 'invitee-id' },
    });
    const token = tokenFor('invitee-id');

    const result = await establishLinkSession(auth, token, 'refresh-1');

    expect(result).toEqual({ error: null });
    expect(setSessionCalls).toEqual([{ access_token: token, refresh_token: 'refresh-1' }]);
  });

  it('the link\'s own user already signed in: kept, no second sign-in', async () => {
    const { auth, setSessionCalls } = fakeAuth({ signedIn: 'invitee-id' });

    const result = await establishLinkSession(auth, tokenFor('invitee-id'), 'refresh-1');

    expect(result).toEqual({ error: null });
    expect(setSessionCalls).toEqual([]);
  });

  it('nobody signed in: signs in with the link\'s tokens', async () => {
    const { auth, setSessionCalls } = fakeAuth({
      signedIn: null,
      setSessionResult: { userId: 'invitee-id' },
    });

    expect(await establishLinkSession(auth, tokenFor('invitee-id'), 'r')).toEqual({ error: null });
    expect(setSessionCalls).toHaveLength(1);
  });

  it('an unreadable token never keeps the existing session', async () => {
    const { auth, setSessionCalls } = fakeAuth({
      signedIn: 'partner-id',
      setSessionResult: { userId: 'invitee-id' },
    });

    expect(await establishLinkSession(auth, 'garbled', 'r')).toEqual({ error: null });
    expect(setSessionCalls).toHaveLength(1);
  });

  it('the auth server\'s own error comes back as is', async () => {
    const { auth } = fakeAuth({
      signedIn: 'partner-id',
      setSessionResult: { userId: null, error: 'Invalid Refresh Token: Already Used' },
    });

    expect(await establishLinkSession(auth, tokenFor('invitee-id'), 'r'))
      .toEqual({ error: 'Invalid Refresh Token: Already Used' });
  });

  it('a session that lands on a different user than the link is refused', async () => {
    const { auth } = fakeAuth({
      signedIn: 'partner-id',
      setSessionResult: { userId: 'partner-id' },
    });

    const result = await establishLinkSession(auth, tokenFor('invitee-id'), 'r');
    expect(result.error).toMatch(/did not match/);
  });

  it('no user after setSession is an error, not a silent pass', async () => {
    const { auth } = fakeAuth({ signedIn: null, setSessionResult: { userId: null } });

    const result = await establishLinkSession(auth, tokenFor('invitee-id'), 'r');
    expect(result.error).toMatch(/did not match/);
  });
});
