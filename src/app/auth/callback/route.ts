import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Handles the PKCE code exchange after a user clicks a Supabase auth link
// (password recovery / set-password for provisioned members).
//
// Supabase redirects here with ?code=... after validating the token.
// We exchange the code for a session, then send the user to the dashboard.
// Without this route, the code is never exchanged and the user is not signed in.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/en/dashboard';

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll(); },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          },
        },
      }
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error('auth/callback exchangeCodeForSession error:', error.message);
  }

  return NextResponse.redirect(`${origin}/en/signin?error=auth_callback_error`);
}
