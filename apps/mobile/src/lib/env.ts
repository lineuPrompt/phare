/**
 * The three EXPO_PUBLIC_ values the app cannot run without.
 *
 * FAILS LOUD, AT STARTUP, BY DESIGN. `process.env.EXPO_PUBLIC_X` is inlined by
 * Metro at build time, so an unset variable does not become undefined at
 * runtime in a way you can catch later — it becomes the literal string
 * "undefined" baked into the bundle. A Supabase client built on
 * "undefined" does not throw: it issues requests to a nonsense URL and every
 * call fails with a network error, which reads as "the API is down" rather
 * than "you forgot to copy .env.example". Naming the missing variable here
 * turns a confusing outage into a one-line fix.
 *
 * The same doctrine as the web side's well-known routes: refuse to run
 * misconfigured rather than run wrong.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value === 'undefined') {
    throw new Error(
      `${name} is not set. Copy apps/mobile/.env.example to apps/mobile/.env.local ` +
        `and fill it in, then restart the dev server — Expo inlines EXPO_PUBLIC_* ` +
        `at build time, so a running bundler will not pick up the change on its own.`
    );
  }
  return value;
}

export const SUPABASE_URL = required(
  'EXPO_PUBLIC_SUPABASE_URL',
  process.env.EXPO_PUBLIC_SUPABASE_URL
);

export const SUPABASE_ANON_KEY = required(
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
);

/** No trailing slash, so callers can concatenate `/api/...` unconditionally. */
export const API_URL = required(
  'EXPO_PUBLIC_API_URL',
  process.env.EXPO_PUBLIC_API_URL
).replace(/\/+$/, '');
