'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';

export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    // Read hash immediately so it's available even if the client clears it.
    const hash = window.location.hash.slice(1);
    const params = new URLSearchParams(hash);
    const accessToken  = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const tokenType    = params.get('type'); // 'recovery' for provisioning emails

    const next = searchParams.get('next') ?? '/en/dashboard';

    if (!accessToken || !refreshToken) {
      router.replace('/en/signin?error=no_tokens');
      return;
    }

    const supabase = createClient();

    // The @supabase/ssr browser client may have already processed the hash tokens
    // during its async initialize(). Check for an existing session first so we
    // don't call setSession concurrently with the client's own initialization.
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        // Client already established a session from the hash — just redirect.
        if (tokenType === 'recovery') {
          router.replace(`/en/set-password?next=${encodeURIComponent(next)}`);
        } else {
          router.replace(next);
        }
        return;
      }

      // No session yet — set it manually with the tokens from the hash.
      const { error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error) {
        // Surface the real error in the URL so it's visible during debugging.
        console.error('[auth/callback] setSession error:', error.message);
        router.replace(`/en/signin?error=${encodeURIComponent(error.message)}`);
        return;
      }

      if (tokenType === 'recovery') {
        router.replace(`/en/set-password?next=${encodeURIComponent(next)}`);
      } else {
        router.replace(next);
      }
    });
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAFAF8' }}>
      <p style={{ color: '#6B7280' }}>Signing you in…</p>
    </div>
  );
}
