import { createClient } from '@supabase/supabase-js';

// Service-role client — bypasses RLS, can call auth.admin.*.
// ONLY used server-side (API routes). Never import this from a client component.
// The service role key is never sent to the browser.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
