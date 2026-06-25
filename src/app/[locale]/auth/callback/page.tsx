'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase';

// The Supabase browser client (createBrowserClient) automatically detects
// #access_token=... in the URL hash and fires onAuthStateChange.
// We never manually parse the hash — we just listen for the event.
//
// PASSWORD_RECOVERY fires when the link comes from a password-reset email.
// The session is valid but the user must call updateUser({password}) before
// doing anything else — otherwise they have no password for future logins.
export default function AuthCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const next = searchParams.get('next') ?? '/en/dashboard';
    const supabase = createClient();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (event === 'PASSWORD_RECOVERY') {
          subscription.unsubscribe();
          router.replace(`/en/set-password?next=${encodeURIComponent(next)}`);
        } else if (event === 'SIGNED_IN' && session) {
          subscription.unsubscribe();
          router.replace(next);
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [router, searchParams]);

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#FAFAF8' }}>
      <p style={{ color: '#6B7280' }}>Signing you in…</p>
    </div>
  );
}
