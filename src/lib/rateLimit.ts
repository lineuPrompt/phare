// ---------------------------------------------------------------------------
// In-process rate limiting for unauthenticated routes.
//
// This generalizes the limiter written inline in /api/auth/forgot-password
// (60s window, Map, prune-on-read, hard entry cap) from a single-shot gate
// ("one per window") to a counted sliding window ("N per window"), because the
// onboarding routes legitimately fire more than once in quick succession — a
// user who drops the wrong file and immediately drops the right one must not
// be locked out.
//
// Caveat, deliberate and identical to the forgot-password limiter: memory is
// per server instance, so N instances allow N windows. This is accepted. The
// exposure being closed is a script hammering one endpoint to burn Anthropic
// spend, and a per-instance cap still bounds that to a small multiple. A
// shared store (table or KV) is the upgrade if abuse ever shows up in
// practice — deliberately NOT built here.
// ---------------------------------------------------------------------------

// Hard cap so a flood of distinct keys can't grow a map without bound.
const RATE_LIMIT_MAX_ENTRIES = 5000;

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Builds a sliding-window limiter. Each returned limiter owns its own Map, so
 * routes never share a budget with each other.
 *
 * Sliding, not fixed-bucket: the stored timestamps older than `windowMs` are
 * dropped on every check, so a caller can't get 2x the limit by straddling a
 * bucket boundary.
 */
export function createRateLimiter(options: { windowMs: number; max: number }) {
  const { windowMs, max } = options;
  const hits = new Map<string, number[]>();

  return function check(key: string, now: number = Date.now()): RateLimitResult {
    // Prune every key, not just the one being checked — otherwise keys that
    // are never queried again would sit in the map until the hard cap fires.
    for (const [k, times] of hits) {
      const live = times.filter((t) => now - t < windowMs);
      if (live.length === 0) hits.delete(k);
      else hits.set(k, live);
    }
    if (hits.size > RATE_LIMIT_MAX_ENTRIES) hits.clear();

    const times = hits.get(key) ?? [];
    if (times.length >= max) {
      // times[0] is the oldest live hit; the window frees a slot when it ages out.
      const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - (now - times[0])) / 1000));
      return { allowed: false, retryAfterSeconds };
    }

    times.push(now);
    hits.set(key, times);
    return { allowed: true };
  };
}

/**
 * Best-effort client IP for keying an unauthenticated limiter.
 *
 * x-forwarded-for is client-controlled in general, but the hosting proxy
 * (Vercel) overwrites it with the real peer address, so it is trustworthy in
 * deployment. Locally it is absent and everything keys to 'unknown' — which
 * is correct for dev, where there is only one caller anyway.
 *
 * Keying on IP rather than a body field is deliberate: these routes are
 * pre-signup, so there is no email or household to key on, and a body field
 * would be trivially rotated by the very script this is meant to stop.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    // Comma-separated chain; the first entry is the originating client.
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}
