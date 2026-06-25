'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createBrowserClient } from '@supabase/ssr';

// The provisioning email uses Supabase implicit flow: tokens land in the URL
// hash fragment (#access_token=...&type=recovery). createBrowserClient defaults
// to flowType:'pkce' and silently ignores hash fragments. Passing flowType:
// 'implicit' here makes the client detect the hash on mount and fire
// onAuthStateChange automatically — no manual setSession needed.
//
// The session is still written to cookies via @supabase/ssr's cookie storage,
// so server components will see it on the next request.
export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = searchParams.get('next') ?? '/en/dashboard';

    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { flowType: 'implicit' } }
    );

    let settled = false;
    let fallback: ReturnType<typeof setTimeout>;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (settled) return;
        if (event === 'PASSWORD_RECOVERY' && session) {
          settled = true;
          clearTimeout(fallback);
          // Member must set a password before using the app —
          // without this they'd have no way to sign in again later.
          router.replace(`/en/set-password?next=${encodeURIComponent(next)}`);
        } else if (event === 'SIGNED_IN' && session) {
          settled = true;
          clearTimeout(fallback);
          router.replace(next);
        }
      }
    );

    // Safety net: if no auth event fires (expired token, bad URL) redirect
    // to sign-in with a clear message after 8 seconds.
    fallback = setTimeout(() => {
      if (!settled) {
        settled = true;
        subscription.unsubscribe();
        router.replace('/en/signin?error=link_expired');
      }
    }, 8000);

    return () => {
      clearTimeout(fallback);
      subscription.unsubscribe();
    };
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAFAF8' }}>
      <p style={{ color: '#6B7280' }}>Signing you in…</p>
    </div>
  );
}
