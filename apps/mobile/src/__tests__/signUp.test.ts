import { describe, it, expect, vi } from 'vitest';
import { CURRENT_LEGAL_VERSION } from '@phare/core';
import { authProblem, cleanCode, emailProblem, newPasswordProblem, signUpParams, signUpProblem } from '../lib/signUp';
import { gateView } from '../lib/authGate';
import { isAuthHeld, setAuthHold, subscribeAuthHold } from '../lib/authHold';
import { acceptCurrentTerms, acceptErrorKeyFor } from '../lib/householdGate';
import { ApiError } from '../lib/apiErrors';

const ok = { fullName: 'Ana', email: 'ana@example.com', password: '12345678', consent: true };

describe('signUpProblem', () => {
  it('a complete form has no problem', () => {
    expect(signUpProblem(ok)).toBeNull();
  });
  it('names the first problem, in the form\'s order', () => {
    expect(signUpProblem({ ...ok, fullName: '   ' })).toBe('nameMissing');
    expect(signUpProblem({ ...ok, email: 'ana@example' })).toBe('emailInvalid');
    expect(signUpProblem({ ...ok, email: 'not an email' })).toBe('emailInvalid');
    expect(signUpProblem({ ...ok, password: '1234567' })).toBe('passwordShort');
    expect(signUpProblem({ ...ok, consent: false })).toBe('consentMissing');
    expect(signUpProblem({ fullName: '', email: '', password: '', consent: false })).toBe('nameMissing');
  });
  it('8 characters is enough, as on the web', () => {
    expect(newPasswordProblem('12345678')).toBeNull();
    expect(newPasswordProblem('1234567')).toBe('passwordShort');
  });
  it('an email with spaces around it is fine', () => {
    expect(emailProblem('  ana@example.com ')).toBeNull();
    expect(emailProblem('ana@')).toBe('emailInvalid');
  });
});

describe('signUpParams', () => {
  it('trims, and sends the name, the language and the platform as the trigger reads them', () => {
    expect(signUpParams({ ...ok, fullName: ' Ana ', email: ' ana@example.com ' }, 'fr')).toEqual({
      email: 'ana@example.com',
      password: '12345678',
      options: { data: { full_name: 'Ana', locale: 'fr', platform: 'mobile' } },
    });
  });
  it('never trims the password', () => {
    expect(signUpParams({ ...ok, password: ' pass word ' }, 'en').password).toBe(' pass word ');
  });
});

describe('cleanCode', () => {
  it('takes 6 to 10 digits, spaces removed', () => {
    expect(cleanCode('123 456')).toBe('123456');
    expect(cleanCode(' 12345678 ')).toBe('12345678');
    expect(cleanCode('1234567890')).toBe('1234567890');
  });
  it('refuses anything else', () => {
    expect(cleanCode('12345')).toBeNull();
    expect(cleanCode('12345678901')).toBeNull();
    expect(cleanCode('12a456')).toBeNull();
    expect(cleanCode('')).toBeNull();
  });
});

describe('authProblem', () => {
  it('no answer at all is offline', () => {
    expect(authProblem({ name: 'AuthRetryableFetchError' }, 'signUp')).toBe('offline');
    expect(authProblem({ status: 0 }, 'verify')).toBe('offline');
  });
  it('rate limits, by status or by code', () => {
    expect(authProblem({ status: 429 }, 'signUp')).toBe('rateLimited');
    expect(authProblem({ status: 400, code: 'over_email_send_rate_limit' }, 'signUp')).toBe('rateLimited');
  });
  it('a weak password', () => {
    expect(authProblem({ status: 422, code: 'weak_password' }, 'signUp')).toBe('passwordWeak');
  });
  it('a wrong or expired code, only when verifying', () => {
    expect(authProblem({ status: 403, code: 'otp_expired' }, 'verify')).toBe('codeInvalid');
    expect(authProblem({ status: 400 }, 'verify')).toBe('codeInvalid');
    expect(authProblem({ status: 401 }, 'verify')).toBe('codeInvalid');
    expect(authProblem({ status: 400 }, 'signUp')).toBe('failed');
  });
  it('anything else, or no error object, is a plain failure', () => {
    expect(authProblem({ status: 500 }, 'verify')).toBe('failed');
    expect(authProblem(null, 'verify')).toBe('failed');
  });
});

describe('the auth hold', () => {
  const signedIn = { status: 'signedIn', session: {} } as Parameters<typeof gateView>[0];
  it('keeps the signed-out screens while a flow finishes, then lets the app in', () => {
    expect(gateView(signedIn, true)).toBe('signIn');
    expect(gateView(signedIn, false)).toBe('content');
    expect(gateView(signedIn)).toBe('content');
    expect(gateView({ status: 'loading' }, true)).toBe('loading');
  });
  it('tells its listeners when it changes, and only then', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAuthHold(listener);
    setAuthHold(true);
    expect(isAuthHeld()).toBe(true);
    setAuthHold(true);
    expect(listener).toHaveBeenCalledTimes(1);
    setAuthHold(false);
    expect(isAuthHeld()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    setAuthHold(true);
    expect(listener).toHaveBeenCalledTimes(2);
    setAuthHold(false);
  });
});

describe('accepting updated terms in the app', () => {
  it('posts the version this build shows to the web\'s own route', async () => {
    const post = vi.fn().mockResolvedValue({ accepted: true });
    await acceptCurrentTerms(post);
    expect(post).toHaveBeenCalledWith('/api/legal/accept', { version: CURRENT_LEGAL_VERSION });
  });
  it('a newer version on the server asks for an app update, never a blind accept', () => {
    expect(acceptErrorKeyFor(new ApiError('server', 409, 'version_mismatch'))).toBe('terms.errors.outdatedApp');
    expect(acceptErrorKeyFor(new ApiError('server', 500, null))).toBe('errors.server');
    expect(acceptErrorKeyFor(new ApiError('network', null, null))).toBe('errors.network');
  });
});
