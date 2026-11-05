// ---------------------------------------------------------------------------
// Sign-up and password reset in the app (S1, Lineu 2026-11-05: "yes sign-up").
//
// Pure, so it is testable without a renderer. The screens call supabase-js
// with what these functions build, and show the keys these functions return.
//
// EMAIL CODES, NOT LINKS. Confirmation and reset emails carry a code the
// person types here (supabase.auth.verifyOtp). A link meant to open an app
// breaks in mail clients that strip non-https links, and needs redirect
// configuration besides; a code works in any inbox and keeps the person in
// the app. The web keeps its links: the same email carries both.
// ---------------------------------------------------------------------------

/** Same minimum as the web's set-password page. */
export const MIN_PASSWORD_LENGTH = 8;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Supabase sends 6 digits by default; a project may be set to up to 10. */
const CODE = /^\d{6,10}$/;

export type SignUpDraft = { fullName: string; email: string; password: string; consent: boolean };

export type SignUpProblem = 'nameMissing' | 'emailInvalid' | 'passwordShort' | 'consentMissing';

export function signUpProblem(d: SignUpDraft): SignUpProblem | null {
  if (!d.fullName.trim()) return 'nameMissing';
  if (!EMAIL.test(d.email.trim())) return 'emailInvalid';
  if (d.password.length < MIN_PASSWORD_LENGTH) return 'passwordShort';
  if (!d.consent) return 'consentMissing';
  return null;
}

/**
 * What supabase.auth.signUp receives. The metadata is what handle_new_user
 * reads: the name, the household's language, and where the sign-up came from
 * (the `signup` event's platform).
 */
export function signUpParams(d: SignUpDraft, locale: 'en' | 'fr') {
  return {
    email: d.email.trim(),
    password: d.password,
    options: { data: { full_name: d.fullName.trim(), locale, platform: 'mobile' } },
  };
}

/** The code as typed, spaces removed; null when it can't be a code. */
export function cleanCode(typed: string): string | null {
  const code = typed.replace(/\s+/g, '');
  return CODE.test(code) ? code : null;
}

export function emailProblem(email: string): 'emailInvalid' | null {
  return EMAIL.test(email.trim()) ? null : 'emailInvalid';
}

export function newPasswordProblem(password: string): 'passwordShort' | null {
  return password.length < MIN_PASSWORD_LENGTH ? 'passwordShort' : null;
}

/** The parts of a supabase-js AuthError this module reads. */
export type AuthFailure = { status?: number; code?: string; name?: string } | null | undefined;

export type AuthProblem = 'offline' | 'rateLimited' | 'passwordWeak' | 'codeInvalid' | 'failed';

/**
 * A supabase-js auth error → the message key's last part. Supabase's English
 * text never reaches the screen (the app is bilingual), and nothing here says
 * whether an address has an account.
 */
export function authProblem(err: AuthFailure, step: 'signUp' | 'verify'): AuthProblem {
  if (!err) return 'failed';
  // AuthRetryableFetchError has no HTTP status: the request never got an answer.
  if (err.status === undefined || err.status === 0) return 'offline';
  if (err.status === 429 || err.code?.startsWith('over_')) return 'rateLimited';
  if (err.code === 'weak_password') return 'passwordWeak';
  if (step === 'verify' && (err.code === 'otp_expired' || err.status === 400 || err.status === 403 || err.status === 401)) {
    return 'codeInvalid';
  }
  return 'failed';
}
