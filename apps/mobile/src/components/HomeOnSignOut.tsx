import { useEffect } from 'react';
import { useNavigationContainerRef } from 'expo-router';
import { supabase } from '../lib/supabase';
import { HOME_STATE, isHome, type NavState } from '../lib/homeOnSignOut';

/**
 * On sign-out, reset navigation to the Overview so the next sign-in opens
 * there (see lib/homeOnSignOut.ts). Mounted once, in the root layout, so it
 * hears every sign-out: Account, the household gate, deletion, an expired
 * session.
 */
export default function HomeOnSignOut() {
  const ref = useNavigationContainerRef();

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {      if (event !== 'SIGNED_OUT' || !ref.isReady()) return;
      if (isHome(ref.getRootState() as NavState | undefined)) return;
      ref.resetRoot(HOME_STATE);
    });
    return () => data.subscription.unsubscribe();
  }, [ref]);

  return null;
}
