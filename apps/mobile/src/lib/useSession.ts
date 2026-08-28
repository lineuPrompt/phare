import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedIn'; session: Session }
  | { status: 'signedOut' };

/**
 * The current session, kept in sync with supabase-js.
 *
 * THE 'loading' STATE IS LOAD-BEARING. Reading the persisted session out of
 * SecureStore is asynchronous, so the first render always has no session even
 * for a signed-in user. Collapsing 'loading' into 'signedOut' would flash the
 * sign-in screen on every cold start — and worse, would look exactly like the
 * bug where a session fails to persist, making that bug invisible.
 *
 * onAuthStateChange fires for sign-in, sign-out, and every token refresh, so
 * the token handed to the API client is always the live one.
 */
export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState(
        data.session
          ? { status: 'signedIn', session: data.session }
          : { status: 'signedOut' }
      );
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(session ? { status: 'signedIn', session } : { status: 'signedOut' });
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
