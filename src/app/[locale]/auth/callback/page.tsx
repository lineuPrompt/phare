'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';

// Handles Supabase auth redirects after the user clicks a set-password email.
//
// Implicit flow (what resetPasswordForEmail sends):
//   /en/auth/callback?next=/en/dashboard#access_token=...&refresh_token=...
//   Tokens are in the URL hash — invisible to any server route, must be read
//   client-side. We call setSession() to establish the session, then redirect.
//
// PKCE flow (future-proofing):
//   /en/auth/callback?code=...&next=/en/dashboard
//   Code is in the query string. We exchange it for a session via the client.
export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = searchParams.get('next') ?? '/en/dashboard';
    const supabase = createClient();

    // --- Implicit flow: tokens in the URL hash ---
    const hash = window.location.hash.substring(1);
    const hashParams = new URLSearchParams(hash);
    const accessToken  = hashParams.get('access_token');
    const refreshToken = hashParams.get('refresh_token');

    if (accessToken && refreshToken) {
      supabase.auth
        .setSession({ access_token: accessToken, refresh_token: refreshToken })
        .then(({ error }) => {
          if (error) {
            console.error('auth/callback setSession error:', error.message);
            router.replace('/en/signin?error=auth_callback_error');
          } else {
            router.replace(next);
          }
        });
      return;
    }

    // --- PKCE flow: code in the query string ---
    const code = searchParams.get('code');
    if (code) {
      supabase.auth
        .exchangeCodeForSession(code)
        .then(({ error }) => {
          if (error) {
            console.error('auth/callback exchangeCode error:', error.message);
            router.replace('/en/signin?error=auth_callback_error');
          } else {
            router.replace(next);
          }
        });
      return;
    }

    // Neither token type found — something went wrong upstream
    router.replace('/en/signin?error=auth_callback_error');
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAFAF8' }}>
      <p style={{ color: '#6B7280' }}>Signing you in…</p>
    </div>
  );
}
