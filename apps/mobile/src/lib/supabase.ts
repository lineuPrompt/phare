import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env';

// ---------------------------------------------------------------------------
// The mobile Supabase client.
//
// NOT @supabase/ssr — that package's createBrowserClient/createServerClient are
// cookie transports, and a native app has no cookie jar. This is plain
// @supabase/supabase-js (the same version the web app already depends on) with
// the session persisted on the device, which is exactly the shape
// src/lib/supabase-server.ts's bearer branch was built to receive.
//
// The token this client holds is what every API call sends as
// `Authorization: Bearer <jwt>`. Nothing else about the server changes: the
// route verifies it with auth.getUser() against Supabase's auth server and
// derives the household from the `users` row, so a device token and a browser
// cookie produce the identical database session.
// ---------------------------------------------------------------------------

/**
 * SecureStore as a supabase-js Storage adapter.
 *
 * WHY SECURESTORE AND NOT AsyncStorage: the value stored here is a live
 * session — an access token plus a refresh token that can mint new access
 * tokens until it is revoked. AsyncStorage is an unencrypted SQLite/plist file
 * readable by anything with filesystem access on a rooted or jailbroken
 * device. SecureStore is the Keychain on iOS and Keystore-backed encrypted
 * SharedPreferences on Android.
 *
 * ON THE "2048-BYTE LIMIT" you may have read about: it is stale. A Supabase
 * session serialises to roughly 2.5-4 KB, which used to trip a size warning in
 * expo-secure-store and sent everyone to write a key-chunking adapter. That
 * warning was REMOVED in expo-secure-store 55.0.0 (2026-01-21), and the 57.0.1
 * shipped here contains no size constant, no length check, and no warning in
 * either the JS or the iOS/Android native sources. A single key is fine.
 *
 * If that ever regresses, the symptom is a session that silently fails to
 * persist across a cold start — the app would ask for a password every launch
 * while working perfectly within one session. Chunking would be the fix; do
 * not switch to AsyncStorage to make it go away.
 */
const SecureStoreAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    persistSession: true,
    autoRefreshToken: true,
    // No URL fragment to read on native. Left on, auth-js would try to parse
    // the launch URL for tokens on every cold start — which on a deep link
    // into the app is a URL it should not be interpreting.
    detectSessionInUrl: false,
  },
});

// ---------------------------------------------------------------------------
// REFRESH ACROSS BACKGROUNDING.
//
// autoRefreshToken is a timer, and a suspended app has no timers. Without this
// the sequence is: background the app for longer than the access token's life,
// return, and the first request goes out with an expired token — a 401 the
// user reads as "it signed me out for no reason".
//
// startAutoRefresh() also refreshes immediately when called, so returning to
// the foreground both catches up and restarts the clock. Web is excluded
// because AppState never leaves 'active' there and the browser tab keeps its
// own timers.
// ---------------------------------------------------------------------------
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  });
}

/**
 * The current access token, or null when signed out.
 *
 * Reads through getSession() rather than caching, because supabase-js swaps
 * the token underneath on refresh and a cached copy would go stale exactly
 * when it matters.
 */
export async function accessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}
