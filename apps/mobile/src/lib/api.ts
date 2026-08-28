import { API_URL } from './env';
import { accessToken } from './supabase';
import { ApiError, kindForStatus } from './apiErrors';

// ---------------------------------------------------------------------------
// The authenticated API client.
//
// Every request carries `Authorization: Bearer <access token>`, which is the
// transport src/lib/supabase-server.ts already accepts on all 37 routes. No
// route needed changing for mobile.
//
// ERRORS ARE CLASSIFIED, NOT FORWARDED. The API's `error` fields are English
// prose written for logs and for a web client that renders its own copy; this
// app is bilingual, so a route's English sentence must never reach the screen.
// Each failure is mapped to an ApiErrorKind, and the screen picks the
// translated string. That is the same decision the web signin page already
// makes for its 429 (see signin/page.tsx — it localizes from
// retryAfterSeconds rather than showing the route's prose).
// ---------------------------------------------------------------------------

async function request<T>(
  path: string,
  init: RequestInit,
  { authenticated }: { authenticated: boolean }
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init.headers as Record<string, string> | undefined),
  };

  if (authenticated) {
    const token = await accessToken();
    // No token means no session. Surfacing this as `unauthorized` here rather
    // than sending an Authorization-less request keeps the caller's handling
    // identical whether the session is missing locally or rejected remotely.
    if (!token) throw new ApiError('unauthorized', null, null);
    headers.Authorization = `Bearer ${token}`;
  }

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers });
  } catch {
    // fetch rejects only on transport failure — no DNS, no route, TLS refused.
    // Every HTTP status, including 500, resolves.
    throw new ApiError('network', null, null);
  }

  if (!response.ok) {
    // Read the body BEFORE discarding it: the routes added in the prompt-caps
    // work put a machine-readable `code` here, and losing it makes a payload
    // rejection indistinguishable from an outage in a bug report.
    const body = await response.json().catch(() => null);
    throw new ApiError(
      kindForStatus(response.status),
      response.status,
      typeof body?.code === 'string' ? body.code : null
    );
  }

  return (await response.json()) as T;
}

/** Authenticated GET. */
export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' }, { authenticated: true });
}

/** Authenticated POST with a JSON body. */
export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { authenticated: true }
  );
}

/**
 * POST to a route that takes no credential.
 *
 * Exactly one caller: the /api/review-stream?stream=0 probe on the
 * diagnostics screen. That route is unauthenticated by design (it reads
 * nothing from the database — see its own header), and sending a bearer token
 * to it would be misleading about what it proves.
 */
export function apiPostUnauthenticated<T>(path: string, body: unknown): Promise<T> {
  return request<T>(
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    { authenticated: false }
  );
}

export { ApiError, messageKeyFor, type ApiErrorKind } from './apiErrors';
