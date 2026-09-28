/**
 * API failure classification.
 *
 * SEPARATE FROM api.ts ON PURPOSE. api.ts imports the Supabase client, which
 * imports react-native — so anything in that file is unreachable from a Node
 * test runner without a native mock. The classification is the part with rules
 * worth pinning, so it lives here where it can be tested directly.
 *
 * THE SERVER'S PROSE NEVER REACHES THE SCREEN. Routes return English `error`
 * strings written for logs and for a web client that renders its own copy.
 * This app is bilingual, so each failure is reduced to a kind and the screen
 * looks up the translated string. The machine-readable `code` is kept for
 * logs — it is what distinguishes a permanent payload rejection from a
 * transient outage — but it is not shown.
 */

export type ApiErrorKind = 'unauthorized' | 'rateLimited' | 'network' | 'server';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number | null;
  /**
   * The server's machine-readable `code`, when it sent one. Screens that know
   * a route's codes map them to their own messages (quickEntry.ts,
   * onboardingFlow.ts); everything else uses `kind`.
   */
  readonly code: string | null;
  /** ONBOARDING_QUOTA_EXHAUSTED's refill date ('YYYY-MM-DD'), when sent. */
  readonly resetsOn: string | null;

  constructor(kind: ApiErrorKind, status: number | null, code: string | null, resetsOn: string | null = null) {
    super(`API ${kind}${status ? ` (${status})` : ''}${code ? ` [${code}]` : ''}`);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.resetsOn = resetsOn;
  }
}

/**
 * HTTP status → failure kind.
 *
 * 401 and 403 are one kind here even though they are different conditions:
 * both mean this device's credential will not do, and the only useful action
 * either way is to sign in again. Anything else — including a 4xx the client
 * caused — is 'server', because there is no action a user can take on it and
 * pretending otherwise wastes their time.
 */
export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rateLimited';
  return 'server';
}

/** The i18n key for a failure, so screens never branch on status codes. */
export function messageKeyFor(err: unknown): string {
  return err instanceof ApiError ? `errors.${err.kind}` : 'errors.server';
}
